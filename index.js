// index.js
require("dotenv").config();
const express = require("express");
const cors = require("cors");
const multer = require("multer");
const path = require("path");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");

const app = express();
const port = process.env.PORT || 5000;

pp.use(cors({
  origin: "https://job-fusion-ten.vercel.app", // replace with your frontend domain
  methods: ["GET", "POST", "PUT", "DELETE"],
}));


app.use(express.json());


const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASSWORD}@cluster0.m8c8ayj.mongodb.net/?retryWrites=true&w=majority`;
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    await client.connect();
    const db = client.db("jobsDB");
    const jobsCollection = db.collection("jobs");
    const usersCollection = db.collection("users");
    const applicationsCollection = db.collection("jobApplications");

 
    app.get("/jobs", async (req, res) => {
      const jobs = await jobsCollection.find().toArray();
      res.json(jobs);
    });

    app.get("/jobs/:id", async (req, res) => {
      const { id } = req.params;
      if (!ObjectId.isValid(id)) return res.status(400).json({ error: "Invalid ID" });

      const job = await jobsCollection.findOne({ _id: new ObjectId(id) });
      if (!job) return res.status(404).json({ error: "Job not found" });

      res.json(job);
    });

    app.post("/jobs", async (req, res) => {
      const job = req.body;
      if (!job.userEmail) return res.status(401).json({ message: "User email required" });

      const user = await usersCollection.findOne({ email: job.userEmail });
      if (!user || user.role !== "admin") return res.status(403).json({ message: "Only admins can post jobs" });

      delete job.userEmail;
      const result = await jobsCollection.insertOne(job);
      res.json(result);
    });

    app.get("/users", async (req, res) => {
      const { email } = req.query;
      if (email) {
        const user = await usersCollection.findOne({ email });
        return res.json(user || {});
      }
      const users = await usersCollection.find().toArray();
      res.json(users);
    });

    app.put("/users", async (req, res) => {
      const { email, ...updatedProfile } = req.body;
      const result = await usersCollection.updateOne(
        { email },
        { $set: updatedProfile },
        { upsert: true }
      );
      res.json(result);
    });


    const upload = multer({ storage: multer.memoryStorage() });

    app.post("/users", upload.single("photo"), async (req, res) => {
      try {
        const newUser = req.body;

        const exists = await usersCollection.findOne({ email: newUser.email });
        if (exists) return res.status(409).json({ message: "User already exists" });

        if (req.file) newUser.photoURL = `Uploaded file received: ${req.file.originalname}`;

        const result = await usersCollection.insertOne(newUser);
        res.json(result);
      } catch (err) {
        console.error("Error in /users POST:", err);
        res.status(500).json({ message: "Internal server error" });
      }
    });

    app.delete("/users/:id", async (req, res) => {
      const { id } = req.params;
      try {
        const result = await usersCollection.deleteOne({ _id: new ObjectId(id) });
        if (result.deletedCount === 1) res.json({ message: "User deleted successfully" });
        else res.status(404).json({ message: "User not found" });
      } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Internal server error" });
      }
    });

    // JOB APPLICATION ROUTES
    app.post("/jobApplication", async (req, res) => {
      const application = req.body;
      const result = await applicationsCollection.insertOne(application);
      res.json(result);
    });

    app.get("/jobApplication", async (req, res) => {
      const { email } = req.query;
      let query = {};
      if (email) query = { applicant_email: email };

      const applications = await applicationsCollection.find(query).toArray();

      // Attach job info
      for (const appItem of applications) {
        const job = await jobsCollection.findOne({ _id: new ObjectId(appItem.job_id) });
        if (job) {
          appItem.job_title = job.job_title;
          appItem.company_name = job.company_name;
          appItem.location = job.location;
          appItem.salary = job.salary;
          appItem.job_type = job.job_type;
        }
      }

      res.json(applications);
    });

    app.delete("/jobApplication/:id", async (req, res) => {
      const { id } = req.params;
      try {
        const result = await applicationsCollection.deleteOne({ _id: new ObjectId(id) });
        if (result.deletedCount === 1) res.json({ message: "Application deleted successfully" });
        else res.status(404).json({ message: "Application not found" });
      } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Internal server error" });
      }
    });

    console.log("✅ MongoDB connected");
  } finally {
    // keep connection alive for serverless
  }
}

run().catch(console.dir);

app.get("/", (req, res) => res.send("Server is running successfully"));


module.exports = app;

app.listen(port, () => {
  console.log(`Server running on PORT: ${port}`);
});
