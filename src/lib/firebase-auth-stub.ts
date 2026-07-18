// Build-time stub for the `firebase/auth` OPTIONAL peer dependency of
// @capacitor-firebase/authentication (aliased in vite.config.ts), mirroring
// src/lib/firebase-messaging-stub.ts.
//
// Why: the plugin ships a WEB implementation (dist/esm/web.js) that statically
// imports the firebase JS SDK, but ProfitSync only ever uses this plugin on
// NATIVE Android/iOS (native Google Sign-In -> Clerk google_one_tap; see
// src/lib/native-google-signin.ts). The web impl is loaded via the plugin's
// own `import("./web")` which the native bridge NEVER calls, so every export
// here is dead code that exists purely so rollup can resolve the import graph.
// Installing the full ~500 kB firebase SDK just to satisfy the bundler would add
// a heavy, never-executed prod dependency (exactly what the messaging stub avoids).
//
// A single callable/constructable no-op backs every name — good enough because
// nothing here runs, and if something ever bypassed the native gate the thrown
// error beats a silent wrong result.
function notInstalled(): never {
  throw new Error(
    "firebase/auth is not installed — @capacitor-firebase/authentication is used " +
      "on native only (see src/lib/native-google-signin.ts).",
  )
}

export const EmailAuthProvider = notInstalled
export const FacebookAuthProvider = notInstalled
export const GithubAuthProvider = notInstalled
export const GoogleAuthProvider = notInstalled
export const OAuthCredential = notInstalled
export const OAuthProvider = notInstalled
export const RecaptchaVerifier = notInstalled
export const TwitterAuthProvider = notInstalled
export const applyActionCode = notInstalled
export const browserLocalPersistence = notInstalled
export const browserSessionPersistence = notInstalled
export const confirmPasswordReset = notInstalled
export const connectAuthEmulator = notInstalled
export const createUserWithEmailAndPassword = notInstalled
export const deleteUser = notInstalled
export const fetchSignInMethodsForEmail = notInstalled
export const getAdditionalUserInfo = notInstalled
export const getAuth = notInstalled
export const getRedirectResult = notInstalled
export const inMemoryPersistence = notInstalled
export const indexedDBLocalPersistence = notInstalled
export const isSignInWithEmailLink = notInstalled
export const linkWithCredential = notInstalled
export const linkWithPhoneNumber = notInstalled
export const linkWithPopup = notInstalled
export const linkWithRedirect = notInstalled
export const reload = notInstalled
export const revokeAccessToken = notInstalled
export const sendEmailVerification = notInstalled
export const sendPasswordResetEmail = notInstalled
export const sendSignInLinkToEmail = notInstalled
export const setPersistence = notInstalled
export const signInAnonymously = notInstalled
export const signInWithCustomToken = notInstalled
export const signInWithEmailAndPassword = notInstalled
export const signInWithEmailLink = notInstalled
export const signInWithPhoneNumber = notInstalled
export const signInWithPopup = notInstalled
export const signInWithRedirect = notInstalled
export const unlink = notInstalled
export const updateEmail = notInstalled
export const updatePassword = notInstalled
export const updateProfile = notInstalled
export const verifyBeforeUpdateEmail = notInstalled
