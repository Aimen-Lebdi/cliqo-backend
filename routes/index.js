const categoryRoutes = require("./categoryRoutes");
const subCategoryRoutes = require("./subCategoryRoutes");
const brandRoutes = require("./brandRoutes");
const productRoutes = require("./productRoutes");
const userRoutes = require("./userRoutes");
const authRoutes = require("./authRoutes");
const wishlistRoutes = require("./wishlistRoutes");
const addressesRoutes = require("./addressesRoutes");
const phonesRoutes = require("./phonesRoutes");
const cartRoutes = require("./cartRoutes");
const orderRoutes = require("./orderRoutes");
const activityRoutes = require("./activityRoutes");

const mountRoutes = (app) => {
  // Health check endpoint for Render deployment
  app.get("/api/v1/health", (req, res) => {
    res.status(200).json({ status: "ok", timestamp: new Date().toISOString() });
  });

  app.use("/api/categories", categoryRoutes);
  app.use("/api/subcategories", subCategoryRoutes);
  app.use("/api/brands", brandRoutes);
  app.use("/api/products", productRoutes);
  app.use("/api/users", userRoutes);
  app.use("/api/auth", authRoutes);
  app.use("/api/wishlist", wishlistRoutes);
  app.use("/api/addresses", addressesRoutes);
  app.use("/api/phones", phonesRoutes);
  app.use("/api/cart", cartRoutes);
  app.use("/api/v1/orders", orderRoutes);
  app.use("/api/activities", activityRoutes);
  app.use("/api/v1/analytics", require("./analyticsRoutes"));
};

module.exports = mountRoutes;