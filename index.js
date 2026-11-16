import express from "express";
import cors from "cors";
import { MongoClient, ObjectId } from "mongodb";
import "dotenv/config";
import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const app = express();

app.use(express.json());
app.use(cors());

const port = process.env.port || 5000;

const client = new MongoClient(process.env.MONGODB_URI);

app.get("/", (req, res) => {
  res.status(200).json({ message: "Hireloop server is running on" });
});

export async function connectToMongoDB() {
  try {
    await client.connect();
    console.log("You successfully connected to MongoDB!");
    app.listen(port, () => {
      console.log(`Hirelopp server is running on ${port}`);
    });
    return client;
  } catch (err) {
    console.dir(err);
  }
}

const connectedMongoDB = await connectToMongoDB();

const db = connectedMongoDB.db(process.env.DB_NAME);
const userCollection = db.collection("user");
const jobCollection = db.collection("jobs");
const applicationCollection = db.collection("applications");
const paymentCollection = db.collection("payments");

app.get("/users", async (req, res) => {
  const cursor = userCollection.find();
  const result = await cursor.toArray();
  res.status(200).json(result);
});

app.get("/users/:id/premium", async (req, res) => {
  const { id } = req.params;

  const query = { _id: new ObjectId(id) };

  const result = await userCollection.findOne(query, {
    projection: { premium: 1 },
  });

  res.status(200).json(result);
});

app.patch("/users/:id", async (req, res) => {
  const { id } = req.params;
  const query = { _id: new ObjectId(id) };

  const updatedDoc = {
    $set: {
      role: req.body.role,
    },
  };

  const result = await userCollection.updateOne(query, updatedDoc);

  res.status(200).json(result);
});

app.post("/jobs", async (req, res) => {
  const job = req.body;

  job.createdAt = new Date();
  job.applicants = 0;
  const deadlineDate = new Date(job.deadline);
  job.status = job.createdAt < deadlineDate ? "active" : "expired";

  const result = await jobCollection.insertOne(job);

  res.status(201).json(result);
});

app.get("/jobs", async (req, res) => {
  let query = {};
  let sort = {};

  if (req.query.jobType) {
    query.jobType = req.query.jobType;
  }

  if (req.query.category) {
    query.category = req.query.category;
  }

  if (req.query.isRemote) {
    query.isRemote = req.query.isRemote === "remote";
  }

  if (req.query.recruiterEmail) {
    query.recruiterEmail = req.query.recruiterEmail;
  }

  if (req.query.search) {
    query.$or = [
      { title: { $regex: req.query.search, $options: "i" } },
      { company: { $regex: req.query.search, $options: "i" } },
      { responsibilities: { $regex: req.query.search, $options: "i" } },
      { requirements: { $regex: req.query.search, $options: "i" } },
    ];
  }

  if (req.query.sortBy) {
    if (req.query.sortBy === "recent") {
      sort.createdAt = -1;
    } else if (req.query.sortBy === "oldest") {
      sort.createdAt = 1;
    } else if (req.query.sortBy === "salaryHigh") {
      sort.maxSalary = -1;
    } else {
      sort.maxSalary = 1;
    }
  }

  const cursor = jobCollection.find(query);
  const result = await cursor.sort(sort).toArray();
  res.status(200).json(result);
});

app.get("/jobs/count", async (req, res) => {
  const query = {};

  if (req.query.recruiterEmail) {
    query.recruiterEmail = req.query.recruiterEmail;
  }
  const result = await jobCollection.countDocuments(query);
  res.send({ count: result });
});

app.get("/jobs/:id", async (req, res) => {
  const id = req.params.id;

  if (!ObjectId.isValid(id)) {
    return res.status(400).json({ message: "Invalid job id" });
  }

  const isExist = await jobCollection.findOne({ _id: new ObjectId(id) });

  if (!isExist) {
    return res.status(404).json({ message: "Job is not found" });
  }

  res.status(200).json(isExist);
});

app.patch("/jobs/:id", async (req, res) => {
  const id = req.params.id;

  if (!ObjectId.isValid(id)) {
    return res.status(400).json({ message: "Invalid job id" });
  }

  const { _id, createdAt, ...updates } = req.body ?? {};

  const result = await jobCollection.updateOne(
    { _id: new ObjectId(id) },
    { $set: updates },
  );

  if (result.matchedCount === 0) {
    return res.status(404).json({ message: "Job is not found" });
  }

  res.status(200).json(result);
});

app.delete("/jobs/:id", async (req, res) => {
  const id = req.params.id;

  if (!ObjectId.isValid(id)) {
    return res.status(400).json({ message: "Invalid job id" });
  }

  const isExist = await jobCollection.findOne({ _id: new ObjectId(id) });

  if (!isExist) {
    return res.status(404).json({ message: "Job is not found" });
  }

  const result = await jobCollection.deleteOne({ _id: new ObjectId(id) });
  res.status(200).json(result);
});

app.post("/applications", async (req, res) => {
  const application = req.body;

  application.appliedAt = new Date();
  application.status = "applied";

  const result = await applicationCollection.insertOne(application);

  res.status(201).json(result);
});

app.get("/applications", async (req, res) => {
  let query = {};

  if (req.query.applicantId) {
    query.userId = req.query.applicantId;
  }

  if (req.query.jobId) {
    query.jobId = req.query.jobId;
  }

  const cursor = applicationCollection.find(query);
  const result = await cursor.toArray();
  res.status(200).json(result);
});

app.patch("/applications/:id", async (req, res) => {
  const { id } = req.params;
  const query = { _id: new ObjectId(id) };
  const updatedDoc = {
    $set: {
      status: req.body.status,
    },
  };

  const result = await applicationCollection.updateOne(query, updatedDoc);

  res.status(200).json(result);
});

app.get("/applications/count", async (req, res) => {
  const query = {};
  if (req.query.applicantId) {
    query.userId = req.query.applicantId;
  }
  const result = await applicationCollection.countDocuments(query);
  res.send({ count: result });
});

app.post("/payments/checkout-verify", async (req, res) => {
  const { sessionId } = req.body;

  if (!sessionId) {
    return res.send({ success: false, message: "Session ID is required" });
  }

  const { status, payment_status, customer_email, metadata, payment_intent } =
    await stripe.checkout.sessions.retrieve(sessionId);

  if (status === "complete" && payment_status === "paid") {
    const sessionQuery = { sessionId };
    const existingPayment = await paymentCollection.findOne(sessionQuery);
    if (existingPayment) {
      return res.send({ success: false, message: "Payment already verified" });
    }
    const payment = {
      sessionId,
      status,
      payment_status,
      customer_email,
      userId: metadata.userId,
      payment_date: new Date(),
      payment_intent,
    };

    const result = await paymentCollection.insertOne(payment);

    // update the user table
    const query = { _id: new ObjectId(metadata.userId) };

    const updatedDoc = {
      $set: {
        premium: true,
      },
    };
    const updateResult = await userCollection.updateOne(query, updatedDoc);
    res.send({ success: true, result, updateResult });
    return;
  }
  res.send({ success: false, message: "Payment verification failed" });
});

app.get("/payments", async (req, res) => {
  const cursor = paymentCollection.find();
  const result = await cursor.toArray();
  res.status(200).json(result);
});
