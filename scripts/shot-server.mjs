import http from "node:http";
import fs from "node:fs";

// tiny screenshot receiver: page POSTs base64 JPEGs here for QA inspection
const server = http.createServer((req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }
  if (req.method === "POST") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const name = req.url.slice(1) || "shot";
      const clean = name.replace(/[^a-zA-Z0-9_-]/g, "");
      fs.writeFileSync(`shots/${clean}.jpg`, Buffer.from(body, "base64"));
      console.log(`saved shots/${clean}.jpg (${body.length} chars)`);
      res.writeHead(200);
      res.end("ok");
    });
    return;
  }
  res.writeHead(404);
  res.end();
});

fs.mkdirSync("shots", { recursive: true });
server.listen(8200, () => console.log("shot receiver on :8200"));
