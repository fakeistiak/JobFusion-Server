const express = require("express");
const cors = require("cors");
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const app = express();
const port =process.env.PORT || 5000;

//middleware
app.use(cors());
app.use(express.json());


//jobFusion 
//mViEPEodRgqV3sca


const uri = "mongodb://localhost:27017";

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


    const jobsCollection=client.db("jobsDB").collection("jobs");

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


    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
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