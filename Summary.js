const AWS = require("aws-sdk");
const zlib = require("zlib");
const path = require("path");
const fs = require("fs");
const fsp = require("fs").promises;
const AmazonS3URI = require("amazon-s3-uri");
const {
  Worker,
  isMainThread,
  workerData,
  parentPort,
} = require("worker_threads");


let s3 = new AWS.S3({
  apiVersion: "2006-03-01",
});

let comprehend = new AWS.Comprehend({
  region: "us-east-1",
});

let file = workerData.file;
let bucketName = workerData.bucketName;
let role = workerData.role;
let job_id = workerData.jobId;


uploadAnalyzeDownload(file, bucketName, role, job_id);

// // function that returns a promise that retrieves the targz from the s3 bucket and decompresses it
const unzipFromS3 = (key, bucket) => {
  return new Promise(async (resolve, reject) => {
    let options = {
      Bucket: bucket,
      Key: key,
    };

    s3.getObject(options, function (err, res) {
      if (err) return reject(err);
      resolve(zlib.unzipSync(res.Body).toString());
    });
  });
};

// a delay function
function wait(delay) {
  return new Promise((resolve) => setTimeout(resolve, delay));
}

function emptyBucket(bucketName, job_id, callback){
  var params = {
    Bucket: bucketName,
    Prefix: `${job_id}`
  };

  s3.listObjects(params, function(err, data) {
    if (err) return callback(err);

    if (data.Contents.length == 0) callback();

    params = {Bucket: bucketName};
    params.Delete = {Objects:[]};

    data.Contents.forEach(function(content) {
      params.Delete.Objects.push({Key: content.Key});
    });

    s3.deleteObjects(params, function(err, data) {
      if (err) return callback(err);
      if(data.Contents.length == 1000)emptyBucket(bucketName, job_id, callback);
      else callback();
    });
  });
}

// poll in while loop until conditions are met
async function poll(params) {
  let js;
  let i = 0;
  const DELAY = 10000;
  while (js !== "COMPLETED" && i < 50) {
    res = await comprehend.describeEntitiesDetectionJob(params).promise();
    js = res.EntitiesDetectionJobProperties.JobStatus;
    console.log(
      "Comprehend Job " +
        res.EntitiesDetectionJobProperties.JobId +
        " Status: " +
        js
    );
    if (js === "COMPLETED") {
      return res;
    }
    if (js === "FAILED") {
      throw res;
    }
    await wait(DELAY);
    i++;
  }
}

function generateSummary(transcript, entities, sen_count = 3) {
  sentences = transcript.replace(/([.?!])\s*(?=[A-Z])/g, "$1|").split("|");

  let key_words = Array.from(entities.Entities, (element) => {
    return element.Text;
  });

  key_words = [...new Set(key_words)];

  let summary = [];

  for (i = 0; i < sen_count; i++) {
    let entity = key_words.shift();
    for (j = 0; j < sentences.length; j++) {
      if (sentences[j].includes(entity)) {
        summary.push(sentences[j]);
        sentences.splice(j, 1);
        break;
      }
    }
  }

  return summary.join(" ").trim();
}

async function uploadAnalyzeDownload(file, bucketName, role, job_id) {

  let input_s3Uri = `s3://${bucketName}/${file}`;

  let comprehendParams = {
    JobName: `transcript entities : ${job_id}`,
    DataAccessRoleArn: role,
    InputDataConfig: {
      S3Uri: input_s3Uri,
      InputFormat: "ONE_DOC_PER_FILE",
    },
    LanguageCode: "en",
    OutputDataConfig: {
      S3Uri: `s3://${bucketName}/${job_id}`,
    },
  };

  // start the async comprehend job
  let comp_job = await comprehend
    .startEntitiesDetectionJob(comprehendParams)
    .promise();

  let statusParams = {
    JobId: comp_job.JobId,
  };

  let status_complete = await poll(statusParams);

  output_s3Uri =
    status_complete.EntitiesDetectionJobProperties.OutputDataConfig.S3Uri;

  const { region, bucket, key } = AmazonS3URI(output_s3Uri);

  // get resulting file from s3 and decompress the output and convert to json object
  let result = unzipFromS3(key, bucket);

  let data = await result.then((data) => {
    data = data.substring(data.indexOf("{"));
    data = data
      .replace(/\\n/g, "\\n")
      .replace(/\\'/g, "\\'")
      .replace(/\\"/g, '\\"')
      .replace(/\\&/g, "\\&")
      .replace(/\\r/g, "\\r")
      .replace(/\\t/g, "\\t")
      .replace(/\\b/g, "\\b")
      .replace(/\\f/g, "\\f");
    data = data.replace(/[\u0000-\u0019]+/g, "");

    let json = JSON.parse(data);
    return json;
  });


  let options = {
    Bucket: bucketName,
    Key: file,
  };

  let fileText = await s3.getObject(options).promise();

  fileText = fileText.Body.toString('utf-8');

  console.log(fileText);

  let sentence_count = 5;
  let summary = generateSummary(fileText, data, sentence_count);
  console.log(summary);

  let sumUploadParams = { Bucket: bucketName, Key: "", Body: "" };
  // Configure the file stream and obtain the upload parameters

  let sumStream = Buffer.from(summary, 'utf8');

  sumUploadParams.Body = sumStream;
  sumUploadParams.Key = `${job_id}-summary.txt`;

  // call S3 to retrieve upload file to specified bucket
  let finalresult = await s3.upload(sumUploadParams).promise();

  return summary; //upload to s3 bucket
}

module.exports.generateSummaryFromText = uploadAnalyzeDownload;
