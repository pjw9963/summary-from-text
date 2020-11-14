const express = require("express");
const { Worker } = require("worker_threads");
const bodyParser = require("body-parser");
//const summary = require("./Summary.js");
const app = express();
const port = 3000;

// create application/json parser
let jsonParser = bodyParser.json();

app.post("/", jsonParser, (req, res) => {
  let transcript = req.body.transcript;
  parseJSAsync(transcript).catch((err) => {
    console.log(err);
  });
  res.send("submitted!");
});

app.listen(port, () => {
  console.log(`Summary app listening at http://localhost:${port}`);
});

function parseJSAsync(transcript) {
  return new Promise((resolve, reject) => {
    const worker = new Worker("./Summary.js", {
      workerData: { file: transcript },
    });
    worker.on("message", resolve);
    worker.on("error", reject);
    worker.on("exit", (code) => {
      if (code !== 0)
        reject(new Error(`Worker stopped with exit code ${code}`));
    });
  });
}
