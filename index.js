const express = require("express");
const { Worker } = require("worker_threads");
const bodyParser = require("body-parser");
const app = express();
const { v4: uuidv4 } = require("uuid");
const port = 3000;

// create application/json parser
let jsonParser = bodyParser.json();

app.get("/", (req, res) => {
  res.send("Were working :)");
});

app.post("/", jsonParser, (req, res) => {
  let transcript = req.body.transcript;
  let bucket = req.body.bucketName;
  let role = req.body.role;
  let jobId = req.body.jobId;
  parseJSAsync(transcript, bucket, role, jobId).catch((err) => {
    console.log(err);
  });
  res.send(JSON.stringify({ jobId: jobId}));
});

app.listen(port, () => {
  console.log(`Summary app listening at http://localhost:${port}`);
});

function parseJSAsync(transcript, bucket, role, jobId) {
  return new Promise((resolve, reject) => {
    const worker = new Worker("./Summary.js", {
      workerData: { file: transcript, bucketName: bucket, role: role, jobId: jobId },
    });
    worker.on("message", resolve);
    worker.on("error", reject);
    worker.on("exit", (code) => {
      if (code !== 0)
        reject(new Error(`Worker stopped with exit code ${code}`));
    });
  });
}
