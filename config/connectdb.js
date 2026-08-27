const mongoose = require("mongoose");
const dotenv = require("dotenv");
dotenv.config();

const connectdb = () => {
  // Use environment variable if available, otherwise fallback to local
  const mongoURI = process.env.MONGO_DB_URI || 'mongodb://localhost:27017/my-e-commerce';
  
  mongoose.connect(mongoURI).then(() => {
    console.log(`MongoDB connected successfully to: ${mongoURI.split('@')[1] || mongoURI}`);
  }).catch((error) => {
    console.error("MongoDB connection error:", error);
    process.exit(1);
  });
};

module.exports = connectdb;