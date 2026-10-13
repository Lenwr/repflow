import { getApp, getApps, initializeApp } from "firebase/app";
import { getAnalytics, isSupported } from "firebase/analytics";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getFunctions } from "firebase/functions";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY ?? "AIzaSyBmXFyQT515zcHxQsRa_caq3swE5KY_MyU",
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN ?? "repflow-5375e.firebaseapp.com",
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID ?? "repflow-5375e",
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET ?? "repflow-5375e.firebasestorage.app",
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID ?? "691211006569",
  appId: import.meta.env.VITE_FIREBASE_APP_ID ?? "1:691211006569:web:c2a9675b9f75a9fcf168f8",
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID ?? "G-1QCB6HGNZK",
};

export const firebaseApp = getApps().length ? getApp() : initializeApp(firebaseConfig);
export const firebaseAuth = getAuth(firebaseApp);
export const firestore = getFirestore(firebaseApp);
export const firebaseFunctions = getFunctions(firebaseApp, "europe-west1");

// Analytics is optional and must not prevent the app from starting in unsupported browsers.
export const firebaseAnalytics = isSupported().then((supported) =>
  supported ? getAnalytics(firebaseApp) : null,
);
