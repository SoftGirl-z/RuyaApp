import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: "AIzaSyBxpqe1VwtE6-1r-fpo0LVUJSIAJEMv_YE",
  authDomain: "morpheus-3038e.firebaseapp.com",
  projectId: "morpheus-3038e",
  storageBucket: "morpheus-3038e.firebasestorage.app",
  messagingSenderId: "999943876398",
  appId: "1:999943876398:web:912200dab33c07fd88d4bf"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);