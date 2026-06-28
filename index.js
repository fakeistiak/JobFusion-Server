require("dotenv").config();
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");

const uploadsDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const app = express();
const port = process.env.PORT || 5000;

app.use(
  cors({
    origin: ["http://localhost:5173", "http://localhost:5000"],
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
  }),
);

app.use(express.json());
app.use("/uploads", express.static(uploadsDir));

const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: ["http://localhost:5173", "http://localhost:5000"],
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
  },
});

const onlineUsers = {};

io.on("connection", (socket) => {
  console.log("Socket connected:", socket.id);

  socket.on("register", (email) => {
    if (email) {
      onlineUsers[email] = socket.id;
      console.log(`Socket registered: ${email} -> ${socket.id}`);
    }
  });

  socket.on("disconnect", () => {
    for (const email in onlineUsers) {
      if (onlineUsers[email] === socket.id) {
        delete onlineUsers[email];
        console.log(`Socket disconnected: ${email}`);
        break;
      }
    }
  });
});

function emitToUser(email, event, data) {
  const socketId = onlineUsers[email];
  if (socketId) {
    io.to(socketId).emit(event, data);
  }
}

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASSWORD}@cluster0.hch7r.mongodb.net/?appName=Cluster0`;
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
    const notificationsCollection = db.collection("notifications");

    async function createNotification(email, message, type, relatedId, link) {
      const notification = {
        email,
        message,
        type,
        relatedId: relatedId || null,
        link: link || null,
        read: false,
        createdAt: new Date(),
      };
      const result = await notificationsCollection.insertOne(notification);
      return { ...notification, _id: result.insertedId };
    }

    async function notifyAllAdmins(message, type, relatedId, link) {
      const admins = await usersCollection.find({ role: "admin" }).toArray();
      for (const admin of admins) {
        const notif = await createNotification(admin.email, message, type, relatedId, link);
        emitToUser(admin.email, "newNotification", notif);
      }
    }

    app.get("/jobs", async (req, res) => {
      const { status } = req.query;
      const filter = {};
      if (status) filter.status = status;
      const jobs = await jobsCollection.find(filter).toArray();
      res.json(jobs);
    });

    app.get("/jobs/:id", async (req, res) => {
      const { id } = req.params;
      if (!ObjectId.isValid(id))
        return res.status(400).json({ error: "Invalid ID" });

      const job = await jobsCollection.findOne({ _id: new ObjectId(id) });
      if (!job) return res.status(404).json({ error: "Job not found" });

      res.json(job);
    });

    app.post("/jobs", async (req, res) => {
      const job = req.body;
      if (!job.userEmail)
        return res.status(401).json({ message: "User email required" });

      const user = await usersCollection.findOne({ email: job.userEmail });
      if (!user || !["admin", "recruiter"].includes(user.role))
        return res.status(403).json({ message: "Only admins and recruiters can post jobs" });

      job.postedBy = job.userEmail;
      delete job.userEmail;
      job.status = user.role === "admin" ? "approved" : "pending";
      job.createdAt = new Date();

      const result = await jobsCollection.insertOne(job);

      if (user.role === "recruiter") {
        await notifyAllAdmins(
          `${user.name || "A recruiter"} posted "${job.job_title}" — pending approval.`,
          "job_pending",
          result.insertedId.toString(),
          "/job-approvals",
        );
      }

      res.json(result);
    });

    app.patch("/jobs/:id/status", async (req, res) => {
      const { id } = req.params;
      const { status, adminEmail } = req.body;

      if (!ObjectId.isValid(id))
        return res.status(400).json({ message: "Invalid ID" });
      if (!["approved", "rejected"].includes(status))
        return res.status(400).json({ message: "Invalid status" });

      const admin = await usersCollection.findOne({ email: adminEmail });
      if (!admin || admin.role !== "admin")
        return res.status(403).json({ message: "Only admins can approve/reject jobs" });

      try {
        const result = await jobsCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: { status } },
        );
        if (result.matchedCount === 0)
          return res.status(404).json({ message: "Job not found" });

        const job = await jobsCollection.findOne({ _id: new ObjectId(id) });
        if (job && job.postedBy) {
          const msg = status === "approved"
            ? `Your job "${job.job_title}" has been approved and is now live.`
            : `Your job "${job.job_title}" has been rejected.`;
          const notif = await createNotification(job.postedBy, msg, `job_${status}`, id, "/recruiterDashboard");
          emitToUser(job.postedBy, "newNotification", notif);
        }

        res.json({ message: `Job ${status} successfully` });
      } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Internal server error" });
      }
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
        { upsert: true },
      );
      res.json(result);
    });

    const storage = multer.diskStorage({
      destination: (req, file, cb) => cb(null, uploadsDir),
      filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
        const ext = path.extname(file.originalname);
        cb(null, uniqueSuffix + ext);
      },
    });
    const upload = multer({ storage });

    app.post("/users", async (req, res) => {
      try {
        const newUser = req.body;

        if (!newUser || !newUser.email) {
          return res.status(400).json({ message: "Email is required" });
        }

        const existingUser = await usersCollection.findOne({
          email: newUser.email,
        });

        if (existingUser) {
          return res.json(existingUser);
        }

        newUser.role = newUser.role || "candidate";
        await usersCollection.insertOne(newUser);

        const insertedUser = await usersCollection.findOne({
          email: newUser.email,
        });

        res.status(201).json(insertedUser);
      } catch (error) {
        console.error(error);
        res.status(500).json({
          message: "Internal server error",
        });
      }
    });

    app.post("/users/with-photo", upload.single("photo"), async (req, res) => {
      try {
        const newUser = req.body;

        if (!newUser || !newUser.email) {
          return res.status(400).json({ message: "Email is required" });
        }

        const existingUser = await usersCollection.findOne({
          email: newUser.email,
        });

        if (existingUser) {
          return res.json(existingUser);
        }

        if (req.file) {
          newUser.photoURL = "uploads/" + req.file.filename;
        }

        newUser.role = newUser.role || "candidate";
        const result = await usersCollection.insertOne(newUser);

        const insertedUser = await usersCollection.findOne({
          _id: result.insertedId,
        });

        res.status(201).json(insertedUser);
      } catch (error) {
        console.error(error);
        res.status(500).json({
          message: "Internal server error",
        });
      }
    });

    app.delete("/users/:id", async (req, res) => {
      const { id } = req.params;
      try {
        const result = await usersCollection.deleteOne({
          _id: new ObjectId(id),
        });
        if (result.deletedCount === 1)
          res.json({ message: "User deleted successfully" });
        else res.status(404).json({ message: "User not found" });
      } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Internal server error" });
      }
    });

    app.patch("/users/:id/role", async (req, res) => {
      const { id } = req.params;
      const { role } = req.body;

      if (!ObjectId.isValid(id))
        return res.status(400).json({ message: "Invalid ID" });
      if (!["candidate", "recruiter", "admin"].includes(role))
        return res.status(400).json({ message: "Invalid role" });

      try {
        const result = await usersCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: { role } },
        );
        if (result.matchedCount === 0)
          return res.status(404).json({ message: "User not found" });
        res.json({ message: `Role updated to ${role}`, role });
      } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Internal server error" });
      }
    });

    app.get("/my-jobs/:email", async (req, res) => {
      const { email } = req.params;
      const jobs = await jobsCollection
        .find({ postedBy: email })
        .sort({ createdAt: -1 })
        .toArray();
      res.json(jobs);
    });

    // JOB APPLICATION ROUTES
    app.post("/jobApplication", async (req, res) => {
      const application = { ...req.body, status: "pending" };
      const result = await applicationsCollection.insertOne(application);

      // Notify the recruiter who posted the job
      if (application.job_id) {
        const job = await jobsCollection.findOne({
          _id: new ObjectId(application.job_id),
        });
        if (job && job.postedBy) {
          const notif = await createNotification(
            job.postedBy,
            `A new candidate applied for "${job.job_title}".`,
            "new_application",
            application.job_id,
            "/recruiterDashboard",
          );
          emitToUser(job.postedBy, "newNotification", notif);

          // Emit full applicant data for real-time UI update
          emitToUser(job.postedBy, "newApplicant", {
            _id: result.insertedId.toString(),
            job_id: application.job_id,
            applicant_email: application.applicant_email,
            name: application.name,
            phone: application.phone,
            education: application.education,
            linkedIn: application.linkedIn,
            github: application.github,
            portfolio: application.portfolio,
            resume: application.resume,
            coverLetter: application.coverLetter,
            photoURL: application.photoURL,
            salaryExpectation: application.salaryExpectation,
            status: "pending",
            appliedAt: application.appliedAt || new Date().toISOString(),
            job_title: job.job_title,
            company_name: job.company_name,
            location: job.location,
            salary: job.salary,
            job_type: job.job_type,
          });
        }
      }

      res.json(result);
    });

    app.get("/jobApplication", async (req, res) => {
      const { email } = req.query;
      let query = {};
      if (email) query = { applicant_email: email };

      const applications = await applicationsCollection.find(query).toArray();

      for (const appItem of applications) {
        const job = await jobsCollection.findOne({
          _id: new ObjectId(appItem.job_id),
        });
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

    app.get("/job-applications/for-recruiter/:email", async (req, res) => {
      const { email } = req.params;
      try {
        const recruiterJobs = await jobsCollection
          .find({ postedBy: email })
          .toArray();
        const jobIds = recruiterJobs.map((j) => j._id);

        const applications = await applicationsCollection
          .find({ job_id: { $in: jobIds.map((id) => id.toString()) } })
          .toArray();

        for (const appItem of applications) {
          const job = recruiterJobs.find(
            (j) => j._id.toString() === appItem.job_id,
          );
          if (job) {
            appItem.job_title = job.job_title;
            appItem.company_name = job.company_name;
            appItem.location = job.location;
            appItem.salary = job.salary;
            appItem.job_type = job.job_type;
          }
        }

        res.json(applications);
      } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Internal server error" });
      }
    });

    app.patch("/jobApplication/:id/status", async (req, res) => {
      const { id } = req.params;
      const { status, interviewDate, interviewMessage } = req.body;

      if (!ObjectId.isValid(id))
        return res.status(400).json({ message: "Invalid ID" });
      if (!["pending", "reviewing", "accepted", "rejected"].includes(status))
        return res.status(400).json({ message: "Invalid status" });

      try {
        const updateFields = { status };
        if (status === "accepted" && interviewDate) {
          updateFields.interviewDate = interviewDate;
          updateFields.interviewMessage = interviewMessage || "";
        }

        const result = await applicationsCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: updateFields },
        );
        if (result.matchedCount === 0)
          return res.status(404).json({ message: "Application not found" });

        const application = await applicationsCollection.findOne({ _id: new ObjectId(id) });

        if (application && application.applicant_email) {
          const job = await jobsCollection.findOne({ _id: new ObjectId(application.job_id) });
          const jobTitle = job?.job_title || "a job";
          let msg = "";
          let type = "";
          if (status === "accepted") {
            msg = interviewDate
              ? `Congratulations! Your application for "${jobTitle}" has been accepted! Interview scheduled: ${new Date(interviewDate).toLocaleString("en-US", { dateStyle: "full", timeStyle: "short" })}.${interviewMessage ? ` Message: ${interviewMessage}` : ""}`
              : `Congratulations! Your application for "${jobTitle}" has been accepted. The recruiter will contact you soon.`;
            type = "application_accepted";
          } else if (status === "rejected") {
            msg = `Your application for "${jobTitle}" has been rejected. Keep applying to other opportunities!`;
            type = "application_rejected";
          } else if (status === "reviewing") {
            msg = `Your application for "${jobTitle}" is now under review.`;
            type = "application_reviewing";
          }
          if (msg) {
            const notif = await createNotification(application.applicant_email, msg, type, application.job_id, "/appliedJobs");
            emitToUser(application.applicant_email, "newNotification", notif);
          }

          emitToUser(application.applicant_email, "applicationStatusUpdate", {
            applicationId: id,
            status,
            interviewDate: updateFields.interviewDate || null,
            interviewMessage: updateFields.interviewMessage || "",
          });
        }

        res.json({ message: `Application ${status} successfully` });
      } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Internal server error" });
      }
    });

    app.delete("/jobApplication/:id", async (req, res) => {
      const { id } = req.params;
      try {
        const result = await applicationsCollection.deleteOne({
          _id: new ObjectId(id),
        });
        if (result.deletedCount === 1)
          res.json({ message: "Application deleted successfully" });
        else res.status(404).json({ message: "Application not found" });
      } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Internal server error" });
      }
    });

    // NOTIFICATION ROUTES
    app.get("/notifications", async (req, res) => {
      const { email } = req.query;
      if (!email) return res.status(400).json({ message: "Email required" });
      const notifications = await notificationsCollection
        .find({ email })
        .sort({ createdAt: -1 })
        .limit(50)
        .toArray();
      res.json(notifications);
    });

    app.patch("/notifications/:id/read", async (req, res) => {
      const { id } = req.params;
      if (!ObjectId.isValid(id))
        return res.status(400).json({ message: "Invalid ID" });
      await notificationsCollection.updateOne(
        { _id: new ObjectId(id) },
        { $set: { read: true } },
      );
      res.json({ message: "Notification marked as read" });
    });

    app.patch("/notifications/read-all", async (req, res) => {
      const { email } = req.body;
      if (!email) return res.status(400).json({ message: "Email required" });
      await notificationsCollection.updateMany(
        { email, read: false },
        { $set: { read: true } },
      );
      res.json({ message: "All notifications marked as read" });
    });

    console.log("✅ MongoDB connected");
  } finally {
    // keep connection alive for serverless
  }
}

run().catch(console.dir);

app.get("/", (req, res) => res.send("Server is running successfully"));

module.exports = app;

server.listen(port, () => {
  console.log(`Server running on PORT: ${port}`);
});
