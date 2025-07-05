const express = require("express");
const cors = require("cors");
require("dotenv").config();
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const app = express();
const port = process.env.PORT || 5000;

// middleware
app.use(cors());
app.use(express.json());

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
    const jobApplicationCollection = client.db("jobsDB").collection("jobApplications");


    app.get("/jobs", async (req, res) => {
      const cursor = jobsCollection.find();
      const result = await cursor.toArray();
      res.send(result);
    });

    app.get("/jobs/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const job = await jobsCollection.findOne(query);
      res.send(job);
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

    app.post("/users", async (req, res) => {
      const newUser = req.body;

      const exists = await usersCollection.findOne({ email: newUser.email });
      if (exists) {
        return res.status(409).send({ message: "User already exists" });
      }

      const result = await usersCollection.insertOne(newUser);
      res.send(result);
    });

    app.post("/jobApplication", async (req, res) => {
      const application = req.body;
      const result = await jobApplicationCollection.insertOne(application);
      res.send(result);
    });

    app.get("/jobApplication", async (req, res) => {
      const email = req.query.email;
      const query = { applicant_email: email };
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

    console.log("✅ Connected to MongoDB!");
  } finally {
    // do not close client to keep connection for dev
  }
}
run().catch(console.dir);

// Test Route
app.get("/", (req, res) => {
  res.send("Server is running successfully");
});

app.listen(port, () => {
  console.log(`Server running on PORT: ${port}`);
});
