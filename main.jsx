import React, { useEffect, useMemo, useState, createContext, useContext } from "react";
import { initializeApp, getApps } from "firebase/app";
import {
  getAuth,
  onAuthStateChanged,
  signInWithPopup,
  GoogleAuthProvider,
  signOut,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendEmailVerification,
  updateProfile,
} from "firebase/auth";
import {
  getDatabase,
  ref,
  push,
  set,
  onValue,
  serverTimestamp,
  update,
  runTransaction,
  off,
} from "firebase/database";
import { getStorage, ref as sref, uploadBytes, getDownloadURL } from "firebase/storage";
import { v4 as uuidv4 } from "uuid";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Search, LogOut, Plus, ThumbsUp, MessageCircle, MoreHorizontal, Flag, ShieldAlert, Trash } from "lucide-react";

// =========================
// Firebase Setup
// =========================
const firebaseConfig = {
  apiKey: "AIzaSyByimpRRxM1BttElKMYgOu0MCSEMaFZhP4",
  authDomain: "chalkboard-a4236.firebaseapp.com",
  projectId: "chalkboard-a4236",
  storageBucket: "chalkboard-a4236.appspot.com",
  messagingSenderId: "743126712811",
  appId: "1:743126712811:web:79dfb6a77b771156cb19ae",
};

if (!getApps().length) {
  initializeApp(firebaseConfig);
}

const auth = getAuth();
const db = getDatabase();
const storage = getStorage();

// =========================
// Auth Context
// =========================
const AuthContext = createContext(null);
const useAuth = () => useContext(AuthContext);

function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      setUser(u);
      if (u) {
        const adminRef = ref(db, `admins/${u.uid}`);
        onValue(adminRef, (snap) => {
          setIsAdmin(!!snap.val());
        });
      }
      setLoading(false);
    });
    return () => unsub();
  }, []);

  const signInGoogle = async () => {
    try {
      const provider = new GoogleAuthProvider();
      await signInWithPopup(auth, provider);
    } catch (e) {
      toast.error(e.message);
    }
  };

  const signInEmail = (email, pw) => signInWithEmailAndPassword(auth, email, pw);

  const signUpEmail = async (email, pw, displayName, inviteCode) => {
    const invRef = ref(db, `invites/${inviteCode}`);
    const snap = await new Promise((res) => onValue(invRef, res, { onlyOnce: true }));
    if (!snap.exists()) throw new Error("Invalid invite code");

    const cred = await createUserWithEmailAndPassword(auth, email, pw);
    await updateProfile(cred.user, { displayName });
    await sendEmailVerification(cred.user);
    await set(invRef, null); // consume invite
    toast.success("Account created. Verify your email.");
  };

  const logout = () => signOut(auth);

  return <AuthContext.Provider value={{ user, loading, isAdmin, signInGoogle, signInEmail, signUpEmail, logout }}>{children}</AuthContext.Provider>;
}

// =========================
// Moderation
// =========================
const bannedWords = ["slur1", "slur2", "curse"]; // expand this list
function filterText(text) {
  let clean = text;
  for (let w of bannedWords) {
    const re = new RegExp(w, "ig");
    clean = clean.replace(re, "***");
  }
  return clean;
}

async function banUser(uid) {
  await set(ref(db, `bans/${uid}`), { bannedAt: Date.now() });
}

function useBans(uid) {
  const [banned, setBanned] = useState(false);
  useEffect(() => {
    if (!uid) return;
    const bRef = ref(db, `bans/${uid}`);
    const handler = onValue(bRef, (snap) => setBanned(!!snap.val()));
    return () => off(bRef, "value", handler);
  }, [uid]);
  return banned;
}

// =========================
// Post creation with image upload
// =========================
async function uploadImage(file) {
  const id = uuidv4();
  const fileRef = sref(storage, `uploads/${id}-${file.name}`);
  await uploadBytes(fileRef, file);
  return getDownloadURL(fileRef);
}

async function createPost({ title, body, file, user }) {
  let imageUrl = "";
  if (file) imageUrl = await uploadImage(file);

  const id = uuidv4();
  await set(ref(db, `posts/${id}`), {
    title: filterText(title),
    body: filterText(body),
    imageUrl,
    authorId: user.uid,
    authorName: user.displayName || user.email.split("@")[0],
    createdAt: Date.now(),
    score: 0,
    commentCount: 0,
  });
  return id;
}

// =========================
// UI additions
// =========================
function AdminPanel() {
  const { isAdmin } = useAuth();
  const [invCode, setInvCode] = useState("");

  const generateInvite = async () => {
    const code = uuidv4().slice(0, 6);
    await set(ref(db, `invites/${code}`), { createdAt: Date.now() });
    setInvCode(code);
  };

  if (!isAdmin) return null;
  return (
    <Card className="mt-6">
      <CardHeader><CardTitle>Admin Tools</CardTitle></CardHeader>
      <CardContent>
        <Button onClick={generateInvite}>Generate Invite</Button>
        {invCode && <p className="mt-2 font-mono">Code: {invCode}</p>}
      </CardContent>
    </Card>
  );
}

// =========================
// Example CreatePost UI updated for file upload
// =========================
function CreatePost({ onCreated }) {
  const { user } = useAuth();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [file, setFile] = useState(null);

  const submit = async () => {
    if (!title.trim()) return;
    const id = await createPost({ title, body, file, user });
    setTitle("");
    setBody("");
    setFile(null);
    onCreated?.(id);
    toast.success("Posted");
  };

  if (!user) return null;
  return (
    <Card className="p-3 space-y-2">
      <Input placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)} />
      <Textarea placeholder="Body" value={body} onChange={(e) => setBody(e.target.value)} />
      <input type="file" accept="image/*" onChange={(e) => setFile(e.target.files[0])} />
      <Button onClick={submit}>Post</Button>
    </Card>
  );
}

// =========================
// Main App Root
// =========================
export default function ChalkBoardApp() {
  return (
    <AuthProvider>
      <div className="max-w-3xl mx-auto p-4">
        <h1 className="text-2xl font-bold">ChalkBoard</h1>
        <CreatePost />
        <AdminPanel />
      </div>
    </AuthProvider>
  );
}

// =========================
// Firebase Rules (important)
// =========================
// {
//   "rules": {
//     ".read": "auth != null && !root.child('bans').child(auth.uid).exists()",
//     ".write": "auth != null && !root.child('bans').child(auth.uid).exists()",
//     "admins": { ".read": "auth != null", ".write": "root.child('admins').child(auth.uid).exists()" },
//     "invites": { ".write": "root.child('admins').child(auth.uid).exists()" },
//     "bans": { ".write": "root.child('admins').child(auth.uid).exists()" }
//   }
// }
