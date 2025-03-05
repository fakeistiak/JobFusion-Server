const express = require("express");
const cors = require("cors");
require('dotenv').config();
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const app = express();
const port =process.env.PORT || 5000;

//middleware
app.use(cors());
app.use(express.json());



console.log(process.env.DB_USER);
console.log(process.env.DB_PASSWORD);


const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASSWORD}@cluster0.m8c8ayj.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;
console.log(uri);

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    await client.connect();


    //Database Collections
    const jobsCollection=client.db("jobsDB").collection("jobs");
    const usersCollection=client.db("jobsDB").collection("users");
    const jobApplicationCollection=client.db("jobsDB").collection("jobApplications");


    //jobs api's
    app.get("/jobs",async(req,res)=>{
      const cursor=jobsCollection.find()
      const result=await cursor.toArray();
      res.send(result)
    })

    app.get("/jobs/:id",async(req,res)=>{
      const id=req.params.id;
      const query={_id:new ObjectId(id)}
      const job =await jobsCollection.findOne(query)
      res.send(job)
    })
    
    app.post("/jobs",async(req,res)=>{
      const job=req.body;
      console.log("new job",job);
      const result=await jobsCollection.insertOne(job);
      res.send(result);
    })


    //Users api's
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
    
    app.post("/users",async(req,res)=>{
      const newUser=req.body;
      console.log("new user",newUser);
      const result=await usersCollection.insertOne(newUser);
      res.send(result);
    })


    //job application api's
    app.post('/jobApplication',async(req,res)=>{
      const application=req.body;
      const result=await jobApplicationCollection.insertOne(application);
      res.send(result);
    })

    app.get('/jobApplication',async(req,res)=>{
      const email=req.query.email;
      const query={applicant_email:email};
      const result=await jobApplicationCollection.find(query).toArray();

      for(const application of result){
        console.log(application.job_id);
        const query2={_id: new ObjectId(application.job_id)}
      const job=await jobsCollection.findOne(query2);
      if(job){
        application.job_title=job.job_title;
        application.company_name=job.company_name;
        application.remote_or_onsite=job.remote_or_onsite;
        application.location=job.location;
        application.salary=job.salary;
        application.logo=job.logo;
        application.job_type=job.job_type;
      }
      }

      res.send(result);
    })


    // Send a ping to confirm a successful connection
    // await client.db("admin").command({ ping: 1 });
    console.log("Pinged your deployment. You successfully connected to MongoDB!");
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);





app.get("/", (req, res) => {
res.send("Server is running successfully");
});

app.listen(port, () => {
console.log(`Server running on PORT: ${port}`);
});