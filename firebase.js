import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyAxTIXCfRGP8GY6-FqGc9ijSneT10swto0",
  authDomain: "split-it-fc44f.firebaseapp.com",
  projectId: "split-it-fc44f",
  storageBucket: "split-it-fc44f.firebasestorage.app",
  messagingSenderId: "250983697151",
  appId: "1:250983697151:web:49102dd02b01b901249aca",
  measurementId: "G-QZYPL00PT3"
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);