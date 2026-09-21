import { clerkSetup } from "@clerk/testing/playwright";
import { test as setup } from "@playwright/test";

/**
 * Obtain a Clerk Testing Token for this run.
 *
 * `clerkSetup` exchanges the instance's secret key for a short-lived Testing
 * Token, which is Clerk's supported way of letting an automated browser
 * through bot protection. It is not a credential for the user and it does not
 * skip authentication: the sign-in that follows is a real Clerk sign-in, and
 * the session it produces is validated by the application exactly as any
 * other session is.
 *
 * The token lives in the runner's process environment and is never written to
 * disk, printed, or committed.
 */
setup("acquire a Clerk testing token", async () => {
  if (!process.env.CLERK_PUBLISHABLE_KEY && process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY) {
    // The app names this variable for the browser bundle; the test package
    // expects the neutral name. Same value, same development instance.
    process.env.CLERK_PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
  }
  await clerkSetup();
});
