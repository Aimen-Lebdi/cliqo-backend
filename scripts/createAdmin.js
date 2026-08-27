#!/usr/bin/env node
/**
 * createAdmin.js
 *
 * Interactive CLI to create an admin user in the database.
 *
 * - Loads the correct environment file (mirrors backend/server.js):
 *     .env.production  when NODE_ENV=production
 *     .env.development otherwise
 * - Connects inline to MongoDB (does NOT import connectdb.js or server.js).
 * - Prompts for name/email via readline (line mode) and for the password via
 *   readline with masked echo (one "*" per typed character) so it is never
 *   shown in plain text.
 * - Validates input against the User model rules and creates a
 *   `role: "admin"` user. The model's pre("save") hook hashes the password.
 *
 * Usage:
 *   npm run create-admin                                    # development
 *   NODE_ENV=production npm run create-admin                # production
 */

const path = require("path");
const dotenv = require("dotenv");
const mongoose = require("mongoose");
const readline = require("readline/promises");
const readlineClassic = require("readline");

const User = require("../models/userModel");
const sendEmail = require("../utils/sendEmail");

// ====================================
// Load the correct environment file
// (mirrors backend/server.js convention)
// ====================================
const envFile =
  process.env.NODE_ENV === "production"
    ? ".env.production"
    : ".env.development";

dotenv.config({ path: path.resolve(__dirname, "..", envFile) });

const mongoURI =
  process.env.MONGO_DB_URI || "mongodb://localhost:27017/my-e-commerce";

// Same email pattern enforced by the User model.
const EMAIL_REGEX = /^\w+([\.-]?\w+)*@\w+([\.-]?\w+)*(\.\w{2,3})+$/;

// ====================================
// Hidden input (masked echo)
// ====================================

/**
 * Prompt for a secret without echoing it. Each typed character is shown as
 * "*".
 *
 * Uses readline in terminal mode (same as the name/email prompts) but
 * intercepts what it writes to stdout so the typed input is masked. This
 * works whether or not raw mode / process.stdin.isTTY is available, so the
 * password never appears in plain text (the old raw-mode fallback that
 * echoed the real characters is gone).
 */
async function readHidden(question) {
  const rl = readlineClassic.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true,
    historySize: 0, // never store the secret in readline history
  });

  // Redirect this readline instance's echo. On a full line re-render
  // (prompt + input) keep the prompt readable and mask only the input;
  // on incremental writes (a typed character, CR/LF, …) mask printable
  // characters. ANSI control sequences are left untouched.
  const origWrite = rl._writeToOutput.bind(rl);
  rl._writeToOutput = (stringToWrite) => {
    const prompt = rl._prompt || "";
    if (
      typeof stringToWrite === "string" &&
      stringToWrite.startsWith(prompt) &&
      stringToWrite.length >= prompt.length + rl.line.length
    ) {
      // Full line re-render: prompt stays, input becomes stars.
      origWrite(prompt + "*".repeat(rl.line.length));
    } else if (stringToWrite === " " && rl.line.length === 0) {
      // Readline writes a trailing space to force a new line — keep it.
      origWrite(" ");
    } else {
      origWrite(stringToWrite.replace(/[^\x00-\x1f\x7f]/g, "*"));
    }
  };

  // Ctrl+C → abort cleanly instead of leaking into the next prompt.
  rl.on("SIGINT", () => {
    rl.close();
    origWrite("\n");
    process.exit(130);
  });

  return new Promise((resolve, reject) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer);
    });
    rl.on("error", reject);
  });
}

/**
 * Ask a question until the validator returns no error message.
 */
async function ask(rl, question, validate) {
  for (;;) {
    const answer = (await rl.question(question)).trim();
    const error = validate ? validate(answer) : null;
    if (!error) return answer;
    console.log(`  ⚠️  ${error}`);
  }
}

// ====================================
// Welcome email
// ====================================

/**
 * Send the welcome email for a newly created admin. Best-effort: the account
 * is already persisted, so an email failure must not fail the script — warn
 * and continue.
 */
async function sendWelcomeEmail(admin) {
  try {
    await sendEmail({
      email: admin.email,
      subject: "Welcome to E-shop — Admin Account Created",
      message: [
        `Hi ${admin.name},`,
        "",
        "Your admin account has been created on E-shop.",
        "",
        "Sign in at the admin panel using:",
        `  Email: ${admin.email}`,
        "",
        "For security, please change your password after your first login.",
        "",
        "The E-shop Team",
      ].join("\n"),
      html: `
  <div style="font-family: Arial, sans-serif; line-height: 1.6;">
    <p>Hi ${admin.name},</p>
    <p>Your <strong>admin</strong> account has been created on E-shop.</p>
    <p>Sign in at the admin panel using:</p>
    <p style="font-size: 18px; font-weight: bold; color: #333; background-color: #f2f2f2; padding: 10px; border-radius: 5px;">${admin.email}</p>
    <p>For security, please change your password after your first login.</p>
    <p>The E-shop Team</p>
  </div>
`,
    });
    console.log(`   📧 Welcome email sent to ${admin.email}`);
  } catch (emailError) {
    console.warn(`   ⚠️  Could not send welcome email: ${emailError.message}`);
  }
}

// ====================================
// Main flow
// ====================================
async function main() {
  console.log("🔧 Environment Configuration:");
  console.log(`📝 Environment: ${process.env.NODE_ENV || "development"}`);
  console.log(`📄 Loading from: ${envFile}`);
  console.log(
    `✅ MONGO_DB_URI: ${process.env.MONGO_DB_URI ? "Loaded" : "Using fallback"}`
  );

  let rl;
  try {
    await mongoose.connect(mongoURI);
    console.log(`✅ MongoDB connected: ${mongoURI.split("@")[1] || mongoURI}`);

    // Text fields first (line mode). Password/confirm use masked echo → last.
    rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    const name = await ask(rl, "  👤 Name: ", (v) =>
      v ? null : "Name is required."
    );
    const email = await ask(rl, "  📧 Email: ", (v) =>
      EMAIL_REGEX.test(v) ? null : "Please enter a valid email."
    );

    rl.close();
    rl = null;

    const password = await readHidden("  🔑 Password (hidden): ");
    const confirm = await readHidden("  🔒 Confirm password (hidden): ");

    if (password.length < 6) {
      console.error("❌ Password must be at least 6 characters.");
      process.exitCode = 1;
      return;
    }
    if (password !== confirm) {
      console.error("❌ Passwords do not match.");
      process.exitCode = 1;
      return;
    }

    // Guard: fail if the email is already taken.
    const existing = await User.findOne({ email });
    if (existing) {
      console.error(`❌ A user with email "${email}" already exists.`);
      process.exitCode = 1;
      return;
    }

    // Warn (but do not block) if other admins already exist.
    const adminCount = await User.countDocuments({ role: "admin" });
    if (adminCount > 0) {
      console.warn(
        `⚠️  ${adminCount} admin(s) already exist — creating another admin.`
      );
    }

    // The User model's pre("save") hook hashes the password.
    const admin = await User.create({
      name,
      email,
      password,
      role: "admin",
      active: true,
    });

    console.log("\n✅ Admin account created successfully!");
    console.log(`   👤 Name:  ${admin.name}`);
    console.log(`   📧 Email: ${admin.email}`);
    console.log(`   🔑 Role:  ${admin.role}`);
    console.log("   🔒 Password: <hidden>");

    await sendWelcomeEmail(admin);
  } catch (error) {
    console.error("❌ Failed to create admin:", error.message);
    process.exitCode = 1;
  } finally {
    process.stdin.removeAllListeners("data");
    process.stdin.pause();
    if (rl) rl.close();
    await mongoose.disconnect();
  }
}

if (require.main === module) {
  main();
}

module.exports = { readHidden };
