
const express = require("express");
const cors = require("cors");
require("dotenv").config();
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");

const app = express();
const port = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, "uploads");
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir);
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    const ext = path.extname(file.originalname);
    cb(null, file.fieldname + "-" + uniqueSuffix + ext);
  },
});

const upload = multer({ storage });

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASSWORD}@cluster0.m8c8ayj.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

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

    const jobsCollection = client.db("jobsDB").collection("jobs");
    const usersCollection = client.db("jobsDB").collection("users");
    const jobApplicationCollection = client
      .db("jobsDB")
      .collection("jobApplications");

    app.get("/jobs", async (req, res) => {
      const cursor = jobsCollection.find();
      const result = await cursor.toArray();
      res.send(result);
    });

    app.get("/jobs/:id", async (req, res) => {
      try {
        const { id } = req.params;
        if (!ObjectId.isValid(id)) {
          return res.status(400).send({ error: "Invalid job ID" });
        }

        const job = await jobsCollection.findOne({ _id: new ObjectId(id) });

        if (!job) {
          return res.status(404).send({ error: "Job not found" });
        }
        res.send(job);
      } catch (error) {
        console.error(error);
        res.status(500).send({ error: "Server error" });
      }
    });

    app.post("/jobs", async (req, res) => {
      const job = req.body;
      const userEmail = job.userEmail;

      if (!userEmail) {
        return res.status(401).send({ message: "User email required" });
      }

      const user = await usersCollection.findOne({ email: userEmail });
      if (!user || user.role !== "admin") {
        return res.status(403).send({ message: "Only admins can post jobs" });
      }

      delete job.userEmail;

      const result = await jobsCollection.insertOne(job);
      res.send(result);
    });

    app.get("/users", async (req, res) => {
      const { email } = req.query;
      if (email) {
        const user = await usersCollection.findOne({ email });
        res.send(user || {});
      } else {
        const result = await usersCollection.find().toArray();
        res.send(result);
      }
    });

    app.put("/users", async (req, res) => {
      const { email, ...updatedProfile } = req.body;
      const filter = { email };
      const update = { $set: updatedProfile };
      const options = { upsert: true };
      const result = await usersCollection.updateOne(filter, update, options);
      res.send(result);
    });

    app.post("/users", upload.single("photo"), async (req, res) => {
      try {
        const newUser = req.body;

        const exists = await usersCollection.findOne({ email: newUser.email });
        if (exists) {
          return res.status(409).send({ message: "User already exists" });
        }

        if (req.file) {
          newUser.photoURL = `/uploads/${req.file.filename}`;
        }

        const result = await usersCollection.insertOne(newUser);
        res.send(result);
      } catch (error) {
        console.error("Error in /users POST:", error);
        res.status(500).send({ message: "Internal server error" });
      }
    });

    app.delete("/users/:id", async (req, res) => {
  const { id } = req.params;
  try {
    const result = await usersCollection.deleteOne({ _id: new ObjectId(id) });

    if (result.deletedCount === 1) {
      res.send({ message: "User deleted successfully" });
    } else {
      res.status(404).send({ message: "User not found" });
    }
  } catch (error) {
    console.error("Error deleting user:", error);
    res.status(500).send({ message: "Internal server error" });
  }
});


    app.post("/jobApplication", async (req, res) => {
      const application = req.body;
      const result = await jobApplicationCollection.insertOne(application);
      res.send(result);
    });

    app.get("/jobApplication", async (req, res) => {
  const email = req.query.email;
  let query = {};

  if (email) {
    // If email is provided, filter by applicant_email
    query = { applicant_email: email };
  }

  const result = await jobApplicationCollection.find(query).toArray();

  for (const application of result) {
    const jobQuery = { _id: new ObjectId(application.job_id) };
    const job = await jobsCollection.findOne(jobQuery);
    if (job) {
      application.job_title = job.job_title;
      application.company_name = job.company_name;
      application.remote_or_onsite = job.remote_or_onsite;
      application.location = job.location;
      application.salary = job.salary;
      application.logo = job.logo;
      application.job_type = job.job_type;
    }
  }

  res.send(result);
});


    app.delete("/jobApplication/:id", async (req, res) => {
      const id = req.params.id;
      try {
        const result = await jobApplicationCollection.deleteOne({
          _id: new ObjectId(id),
        });
        if (result.deletedCount === 1) {
          res.send({ message: "Application deleted successfully" });
        } else {
          res.status(404).send({ message: "Application not found" });
        }
      } catch (error) {
        console.error("Error deleting job application:", error);
        res.status(500).send({ message: "Internal server error" });
      }
    });

    console.log("✅ Connected to MongoDB!");
  } finally {
    // Do not close client connection for dev
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("Server is running successfully");
});

module.exports = app;

app.listen(port, () => {
  console.log(`Server running on PORT: ${port}`);
});
