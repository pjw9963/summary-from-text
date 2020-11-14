const AWS = require("aws-sdk");
const zlib = require("zlib");
const path = require("path");
const fs = require("fs");
const fsp = require('fs').promises;
const { v4: uuidv4 } = require("uuid");
const AmazonS3URI = require("amazon-s3-uri");

let s3 = new AWS.S3({
  apiVersion: "2006-03-01",
});

let comprehend = new AWS.Comprehend({
  region: "us-east-2",
});

let file = process.argv[2];

uploadAnalyzeDownload(file);

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

// checks the status of the submitted comprehend job every ten seconds until complete
const checkStatus = function (params) {
  return new Promise(function (resolve, reject) {
    comprehend.describeEntitiesDetectionJob(params, function (err, data) {
      if (err) console.log(err, err.stack);
      else {
        let jobStatus = data.EntitiesDetectionJobProperties.JobStatus;
        if (jobStatus.match(/^(IN_PROGRESS|SUBMITTED)$/)) {
          setTimeout(() => checkStatus(params), 10000);
          console.log(jobStatus);
        } else if (jobStatus == "COMPLETED") {
          resolve(data);
        } else {
          throw data;
        }
      }
    });
  });
};

// a delay function
function wait(delay) {
  return new Promise((resolve) => setTimeout(resolve, delay));
}

// poll in while loop until conditions are met
async function poll(params) {
  let js;
  let i = 0;
  const DELAY = 10000;
  while (js !== "COMPLETED" && i < 50) {
    res = await comprehend.describeEntitiesDetectionJob(params).promise();
    js = res.EntitiesDetectionJobProperties.JobStatus;
    console.log("Comprehend Job Status: " + js);
    if (js === "COMPLETED") {
      return res;
    }
    await wait(DELAY);
    i++;
  }
}

async function generateSummary(transcript_file, entities, sen_count = 3) {
  let sentences = await fsp.readFile(transcript_file, 'utf8');
  sentences = sentences.replace(/([.?!])\s*(?=[A-Z])/g, "$1|").split("|");
  
  let key_words = Array.from(entities.Entities, (element) => {
      return element.Text;
  });

  key_words = [...new Set(key_words)];

  let summary = [];

  for (i = 0; i < sen_count; i++){
      let entity = key_words.shift();
      for(j = 0; j < sentences.length; j++) {
          if (sentences[j].includes(entity)){
              summary.push(sentences[j]);
              sentences.splice(j,1);
              break;
          }
      }
  }

  return summary.join(' ').trim();
}

async function uploadAnalyzeDownload(file) {
  var uploadParams = { Bucket: "pw-comprehend", Key: "", Body: "" };
  // Configure the file stream and obtain the upload parameters
  let fileStream = fs.createReadStream(file);
  fileStream.on("error", function (err) {
    console.log("File Error", err);
  });
  uploadParams.Body = fileStream;
  uploadParams.Key = `${uuidv4()}-${path.basename(file)}`;

  // call S3 to retrieve upload file to specified bucket
  let input_data = await s3.upload(uploadParams).promise();

  let input_s3Uri = `s3://${input_data.Bucket}/${input_data.key}`;

  let output_unique_key = uuidv4();

  let comprehendParams = {
    JobName: `transcript entities : ${output_unique_key}`,
    DataAccessRoleArn:
      "arn:aws:iam::346519238941:role/service-role/AmazonComprehendServiceRole-test",
    InputDataConfig: {
      S3Uri: input_s3Uri, // test s3uri: s3://pw-comprehend/transcript.txt
      InputFormat: "ONE_DOC_PER_FILE",
    },
    LanguageCode: "en",
    OutputDataConfig: {
      S3Uri: `s3://pw-comprehend-output/${output_unique_key}`,
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
  
  let sentence_count = 5;
  let summary = await generateSummary(file, data, sentence_count);
  console.log(summary);
}
