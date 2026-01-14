const express = require("express");
const app = express();

app.get("/", (req, res) => res.send("OK"));
app.get("/health", (req, res) => res.json({ ok: true }));

app.listen(process.env.PORT || 3000, () => console.log("Running"));
