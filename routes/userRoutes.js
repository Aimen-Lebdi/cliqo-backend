const express = require("express");
const router = express.Router();
const {
  createUser,
  getAllUsers,
  getOneUser,
  updateUser,
  updateUserPassword,
  getLoggedUserData,
  updateLoggedUserPassword,
  updateLoggedUserData,
  uploadUserImage,
  processUserImage,
  banManyUsers,
  unbanManyUsers,
  banUser,
  unbanUser,
} = require("../services/userServices");
const authServices = require("../services/authServices");
const {
  createUserValidator,
  getUserValidator,
  updateUserValidator,
  updateUserPasswordValidator,
  updateLoggedUserDataValidator,
  updateLoggedUserPasswordValidator,
  banManyUsersValidator,
  unbanManyUsersValidator,
  banUserValidator,
} = require("../utils/validators/userValidators");
const handleNullValues = require("../middlewares/handleNullValues");
router.use(authServices.protectRoute);

// ===== USER ROUTES =====
router.get(
  "/getMe",
  authServices.allowTo("user","admin"),
  getLoggedUserData,
  getOneUser
);
router.put(
  "/updateMe",
  authServices.allowTo("user","admin"),
  uploadUserImage,
  processUserImage,
  handleNullValues("image"),
  updateLoggedUserDataValidator,
  updateLoggedUserData
);
router.put(
  "/changeMyPassword",
  authServices.allowTo("user","admin"),
  updateLoggedUserPasswordValidator,
  updateLoggedUserPassword
);

// ===== ADMIN ROUTES =====
router
  .route("/")
  .get(authServices.allowTo("admin"), getAllUsers)
  .post(
    authServices.allowTo("admin"),
    uploadUserImage,
    processUserImage,
    createUserValidator,
    createUser
  );
router
  .route("/bulk-ban")
  .post(
    authServices.allowTo("admin"),
    banManyUsersValidator,
    banManyUsers
  );
router
  .route("/bulk-unban")
  .post(
    authServices.allowTo("admin"),
    unbanManyUsersValidator,
    unbanManyUsers
  );

router
  .route("/:id/ban")
  .put(
    authServices.allowTo("admin"),
    banUserValidator,
    banUser
  );

router
  .route("/:id/unban")
  .put(
    authServices.allowTo("admin"),
    getUserValidator,
    unbanUser
  );

router
  .route("/:id")
  .get(authServices.allowTo("admin"), getUserValidator, getOneUser)
  .put(
    authServices.allowTo("admin"),
    uploadUserImage,
    processUserImage,
    handleNullValues("image"),
    updateUserValidator,
    updateUser
  );

router.put(
  "/changePassword/:id",
  authServices.allowTo("admin"),
  updateUserPasswordValidator,
  updateUserPassword
);

module.exports = router;
