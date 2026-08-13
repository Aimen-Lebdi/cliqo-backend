const expressAsyncHandler = require("express-async-handler");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const userModel = require("../models/userModel");
const endpointError = require("../utils/endpointError");
const sendEmail = require("../utils/sendEmail");
const ActivityLogger = require("../socket/activityLogger");

// FIXED: Generate access token with CORRECT secret
const createAccessToken = (userId) => {
  return jwt.sign({ userId }, process.env.JWT_ACCESS_SECRET_KEY, {
    expiresIn: process.env.JWT_EXPIRE || "15m",
  });
};

// Generate refresh token (long-lived)
const createRefreshToken = (userId) => {
  return jwt.sign({ userId }, process.env.JWT_REFRESH_SECRET, {
    expiresIn: process.env.JWT_REFRESH_EXPIRE || "30d",
  });
};

// Export createAccessToken for use by other services (e.g. userServices)
exports.createAccessToken = createAccessToken;

// Helper: Set refresh token as httpOnly cookie (eliminates duplication across handlers)
const setRefreshTokenCookie = (res, refreshToken) => {
  res.cookie("refreshToken", refreshToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    // NOTE (D2): sameSite "strict" may block the silent-refresh cookie in
    // cross-origin production (frontend cliqo.onrender.com vs backend
    // cliqo-backend.onrender.com). If prod refresh starts failing, switch to
    // "lax" (or "none"+secure) or send the refreshToken in the request body.
    sameSite: "strict",
    maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
  });
};

// Helper: Check if password was changed after token was issued
const isPasswordChangedAfter = (user, tokenIat) => {
  if (user.passwordChangedAt) {
    const passToTimeStamp = parseInt(user.passwordChangedAt.getTime() / 1000, 10);
    return passToTimeStamp > tokenIat;
  }
  return false;
};

exports.signUp = expressAsyncHandler(async (req, res, next) => {
  const user = await userModel.create({
    name: req.body.name,
    email: req.body.email,
    password: req.body.password,
  });

  const accessToken = createAccessToken(user._id);
  const refreshToken = createRefreshToken(user._id);

  setRefreshTokenCookie(res, refreshToken);

  await ActivityLogger.logUserActivity("create", user, user, {
    registrationMethod: "email",
    ipAddress: req.ip,
  });

  // Strip password from response
  const userResponse = user.toObject();
  delete userResponse.password;

  res.status(201).json({
    data: userResponse,
    accessToken,
  });
});

exports.signIn = expressAsyncHandler(async (req, res, next) => {
  // password field is hidden by default (select: false) — explicitly include for comparison
  const user = await userModel.findOne({
    email: req.body.email,
  }).select("+password");

  if (!user || !(await bcrypt.compare(req.body.password, user.password))) {
    return next(new Error("Invalid email or password"));
  }

  if (!user.active) {
    return next(
      new endpointError(
        "Your account has been deactivated. Please contact support for assistance.",
        403
      )
    );
  }

  const accessToken = createAccessToken(user._id);
  const refreshToken = createRefreshToken(user._id);

  setRefreshTokenCookie(res, refreshToken);

  // Strip password from response
  const userResponse = user.toObject();
  delete userResponse.password;

  res.status(200).json({
    data: userResponse,
    accessToken,
  });
});

// Refresh access token
exports.refreshAccessToken = expressAsyncHandler(async (req, res, next) => {
  let refreshToken = (req.cookies && req.cookies.refreshToken) || req.body.refreshToken;

  if (!refreshToken) {
    return next(new endpointError("No refresh token provided", 401));
  }

  try {
    const decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET);
    const user = await userModel.findById(decoded.userId);

    if (!user) {
      return next(new endpointError("User not found", 404));
    }

    if (!user.active) {
      return next(
        new endpointError(
          "Your account has been deactivated.",
          403
        )
      );
    }

    // Check if password was changed after token was issued
    if (isPasswordChangedAfter(user, decoded.iat)) {
      return next(
        new endpointError(
          "User recently changed password, please log in again",
          401
        )
      );
    }

    // Issue new tokens (rolling session)
    const newAccessToken = createAccessToken(user._id);
    const newRefreshToken = createRefreshToken(user._id);

    setRefreshTokenCookie(res, newRefreshToken);

    res.status(200).json({
      accessToken: newAccessToken,
    });
  } catch (error) {
    return next(new endpointError("Invalid refresh token", 401));
  }
});

// FIXED: protectRoute uses CORRECT secret
exports.protectRoute = expressAsyncHandler(async (req, res, next) => {
  let token;
  if (
    req.headers.authorization &&
    req.headers.authorization.startsWith("Bearer")
  ) {
    token = req.headers.authorization.split(" ")[1];
  }

  if (!token) {
    return next(new endpointError("Not authorized", 401));
  }

  try {
    // FIXED: Use JWT_ACCESS_SECRET_KEY
    const decoded = jwt.verify(token, process.env.JWT_ACCESS_SECRET_KEY);
    const currentUser = await userModel.findById(decoded.userId);

    if (!currentUser) {
      return next(new endpointError("User not found", 404));
    }

    if (!currentUser.active) {
      return next(new endpointError("Your account has been deactivated", 403));
    }

    if (isPasswordChangedAfter(currentUser, decoded.iat)) {
      return next(
        new endpointError(
          "User recently changed password, please log in again",
          401
        )
      );
    }

    req.user = currentUser;
    next();
  } catch (error) {
    if (error.name === "TokenExpiredError") {
      return next(
        new endpointError("Access token expired, please refresh", 401)
      );
    }
    return next(new endpointError("Invalid token", 401));
  }
});

exports.allowTo = (...roles) => {
  return expressAsyncHandler(async (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return next(
        new endpointError("You do not have permission to perform this action", 403)
      );
    }
    next();
  });
};

// FIXED: optionalAuth uses CORRECT secret
exports.optionalAuth = expressAsyncHandler(async (req, res, next) => {
  let token;
  if (
    req.headers.authorization &&
    req.headers.authorization.startsWith("Bearer")
  ) {
    token = req.headers.authorization.split(" ")[1];
  }

  if (!token) {
    req.user = { role: "visitor" };
    return next();
  }

  try {
    // FIXED: Use JWT_ACCESS_SECRET_KEY
    const decoded = jwt.verify(token, process.env.JWT_ACCESS_SECRET_KEY);
    const currentUser = await userModel.findById(decoded.userId);

    if (!currentUser) {
      req.user = { role: "visitor" };
      return next();
    }

    if (!currentUser.active) {
      req.user = { role: "visitor" };
      return next();
    }

    if (isPasswordChangedAfter(currentUser, decoded.iat)) {
      req.user = { role: "visitor" };
      return next();
    }

    req.user = currentUser;
    next();
  } catch (error) {
    req.user = { role: "visitor" };
    next();
  }
});

exports.forgotPassword = expressAsyncHandler(async (req, res, next) => {
  const user = await userModel.findOne({ email: req.body.email });

  // Always return success to prevent email enumeration
  if (!user) {
    return res
      .status(200)
      .json({ status: "Success", message: "If an account with that email exists, a reset code has been sent" });
  }

  const resetCode = Math.floor(100000 + Math.random() * 900000).toString();
  const hashedResetCode = crypto
    .createHash("sha256")
    .update(resetCode)
    .digest("hex");

  user.passwordResetCode = hashedResetCode;
  user.passwordResetExpires = Date.now() + 10 * 60 * 1000;
  user.passwordResetVerified = false;

  await user.save();

  const message = `Your reset code is ${resetCode}`;
  const htmlMessage = `
  <div style="font-family: Arial, sans-serif; line-height: 1.6;">
    <p>Hi ${user.name},</p>
    <p>We received a request to reset the password on your E-shop Account.</p>
    <p style="font-size: 24px; font-weight: bold; color: #333; background-color: #f2f2f2; padding: 10px; border-radius: 5px; text-align: center;">${resetCode}</p>
    <p>Enter this code to complete the reset. This code is valid for 10 minutes.</p>
    <p>Thanks for helping us keep your account secure.</p>
    <p>The E-shop Team</p>
  </div>
`;
  try {
    await sendEmail({
      email: user.email,
      subject: "Your password reset code (valid for 10 min)",
      message,
      html: htmlMessage,
    });

    await ActivityLogger.logActivity({
      type: "user",
      activity: "Password Reset Requested",
      user: {
        name: user.name,
        id: user._id,
        role: user.role,
      },
      description: `Password reset code sent to ${user.email}`,
      relatedId: user._id,
      relatedModel: "User",
      metadata: {
        requestTime: new Date(),
        ipAddress: req.ip,
      },
    });
  } catch (err) {
    user.passwordResetCode = undefined;
    user.passwordResetExpires = undefined;
    user.passwordResetVerified = undefined;

    await user.save();
    return next(new endpointError(err, 500));
  }

  res
    .status(200)
    .json({ status: "Success", message: "Reset code sent to email" });
});

exports.verifyPassResetCode = expressAsyncHandler(async (req, res, next) => {
  const hashedResetCode = crypto
    .createHash("sha256")
    .update(req.body.resetCode)
    .digest("hex");

  const user = await userModel.findOne({
    passwordResetCode: hashedResetCode,
    passwordResetExpires: { $gt: Date.now() },
  });
  if (!user) {
    return next(new endpointError("Reset code invalid or expired"));
  }

  user.passwordResetVerified = true;
  await user.save();

  res.status(200).json({
    status: "Success",
  });
});

exports.resetPassword = expressAsyncHandler(async (req, res, next) => {
  const user = await userModel.findOne({ email: req.body.email });
  if (!user) {
    return next(
      new endpointError(`There is no user with email ${req.body.email}`, 404)
    );
  }

  if (!user.passwordResetVerified) {
    return next(new endpointError("Reset code not verified", 400));
  }

  // Assign plain text — pre("save") hook will hash automatically
  user.password = req.body.newPassword;
  user.passwordResetCode = undefined;
  user.passwordResetExpires = undefined;
  user.passwordResetVerified = undefined;
  user.passwordChangedAt = Date.now();

  await user.save();

  // Issue new tokens after password reset
  const accessToken = createAccessToken(user._id);
  const refreshToken = createRefreshToken(user._id);

  setRefreshTokenCookie(res, refreshToken);

  await ActivityLogger.logUserActivity("passwordChange", user, user, {
    resetMethod: "email",
    ipAddress: req.ip,
  });

  res.status(200).json({
    accessToken,
  });
});

exports.logOut = expressAsyncHandler(async (req, res, next) => {
  res.clearCookie("refreshToken");
  res.status(200).json({ status: "Success", message: "Logged out successfully" });
});