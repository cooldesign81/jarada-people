// Firebase 초기화 (모든 페이지에서 공유)
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js";

export const firebaseConfig = {
  apiKey: "AIzaSyCi5HyQ3oGATMXwWUdYHYrlBjS95eW6AYA",
  authDomain: "jarada-people.firebaseapp.com",
  projectId: "jarada-people",
  storageBucket: "jarada-people.firebasestorage.app",
  messagingSenderId: "569769571149",
  appId: "1:569769571149:web:53e04eaa86d663386c7d04"
};

export const app  = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db   = getFirestore(app);
