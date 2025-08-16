import React, { useEffect, useMemo, useRef, useState, createContext, useContext } from "react";
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
import { v4 as uuidv4 } from "uuid";
import { motion, AnimatePresence } from "framer-motion";
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
import { Search, LogOut, Plus, ThumbsUp, MessageCircle, MoreHorizontal, Filter, ShieldAlert, Flag, Flame, Star, Clock } from "lucide-react";

// =========================
// Firebase Setup
// =========================
const firebaseConfig = {
  apiKey: "AIzaSyByimpRRxM1BttElKMYgOu0MCSEMaFZhP4",
  authDomain: "chalkboard-a4236.firebaseapp.com",
  projectId: "chalkboard-a4236",
  storageBucket: "chalkboard-a4236.firebasestorage.app",
  messagingSenderId: "743126712811",
  appId: "1:743126712811:web:79dfb6a77b771156cb19ae",
};

if (!getApps().length) {
  initializeApp(firebaseConfig);
}

const auth = getAuth();
const db = getDatabase();

// =========================
// Auth Context
// =========================
const AuthContext = createContext(null);
const useAuth = () => useContext(AuthContext);

function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setLoading(false);
    });
    return () => unsub();
  }, []);

  const signInGoogle = async () => {
    try {
      const provider = new GoogleAuthProvider();
      await signInWithPopup(auth, provider);
      toast.success("Signed in with Google");
    } catch (e) {
      toast.error(e.message);
    }
  };

  const signInEmail = async (email, password) => {
    try {
      await signInWithEmailAndPassword(auth, email, password);
      toast.success("Signed in");
    } catch (e) {
      toast.error(e.message);
    }
  };

  const signUpEmail = async (email, password, displayName) => {
    try {
      const cred = await createUserWithEmailAndPassword(auth, email, password);
      await updateProfile(cred.user, { displayName });
      await sendEmailVerification(cred.user);
      toast.success("Account created. Verify your email.");
    } catch (e) {
      toast.error(e.message);
    }
  };

  const logout = async () => {
    await signOut(auth);
  };

  const value = { user, loading, signInGoogle, signInEmail, signUpEmail, logout };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// =========================
// Utilities
// =========================
const initials = (name = "?") => name.split(" ").map((s) => s[0]).join("").slice(0, 2).toUpperCase();
const timeAgo = (ts) => {
  if (!ts) return "just now";
  const diff = Date.now() - ts;
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
};

// =========================
// Data Hooks (Realtime Database)
// =========================
function usePosts() {
  const [posts, setPosts] = useState([]);
  useEffect(() => {
    const postsRef = ref(db, "posts");
    const handler = onValue(postsRef, (snap) => {
      const val = snap.val() || {};
      const arr = Object.entries(val)
        .map(([id, p]) => ({ id, ...p }))
        .sort((a, b) => b.createdAt - a.createdAt);
      setPosts(arr);
    });
    return () => off(postsRef, "value", handler);
  }, []);
  return posts;
}

function useComments(postId) {
  const [comments, setComments] = useState([]);
  useEffect(() => {
    if (!postId) return;
    const cRef = ref(db, `comments/${postId}`);
    const handler = onValue(cRef, (snap) => {
      const val = snap.val() || {};
      const arr = Object.entries(val)
        .map(([id, c]) => ({ id, ...c }))
        .sort((a, b) => a.createdAt - b.createdAt);
      setComments(arr);
    });
    return () => off(cRef, "value", handler);
  }, [postId]);
  return comments;
}

// =========================
// Write Ops
// =========================
async function createPost({ title, body, imageUrl, user }) {
  const id = uuidv4();
  const postRef = ref(db, `posts/${id}`);
  const payload = {
    title: title.trim(),
    body: body.trim(),
    imageUrl: imageUrl?.trim() || "",
    authorId: user.uid,
    authorName: user.displayName || user.email.split("@")[0],
    createdAt: Date.now(),
    score: 0,
    commentCount: 0,
    reports: 0,
  };
  await set(postRef, payload);
  return id;
}

async function createComment({ postId, text, user }) {
  const cRef = ref(db, `comments/${postId}/${uuidv4()}`);
  await set(cRef, {
    text: text.trim(),
    authorId: user.uid,
    authorName: user.displayName || user.email.split("@")[0],
    createdAt: Date.now(),
  });
  // increment comment count
  const pRef = ref(db, `posts/${postId}/commentCount`);
  await runTransaction(pRef, (current) => (current || 0) + 1);
}

async function votePost({ postId, uid, value }) {
  // value is 1, -1, or 0 (remove)
  const voteRef = ref(db, `votes/posts/${postId}/${uid}`);
  const scoreRef = ref(db, `posts/${postId}/score`);
  await runTransaction(voteRef, (current) => {
    const prev = current || 0;
    // Adjust score based on delta
    runTransaction(scoreRef, (currentScore) => {
      const cs = currentScore || 0;
      const delta = (value || 0) - prev;
      return cs + delta;
    });
    return value || 0;
  });
}

async function reportPost({ postId }) {
  const rRef = ref(db, `posts/${postId}/reports`);
  await runTransaction(rRef, (current) => (current || 0) + 1);
  toast.message("Reported. Mods will review.");
}

// =========================
// UI Components
// =========================
function Header({ onSearch, query, setQuery }) {
  const { user, logout } = useAuth();
  return (
    <div className="sticky top-0 z-50 backdrop-blur bg-white/70 border-b">
      <div className="max-w-4xl mx-auto flex items-center gap-3 p-3">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-2xl bg-neutral-900 text-white grid place-items-center text-sm font-bold">CB</div>
          <span className="font-extrabold tracking-tight text-xl">ChalkBoard</span>
          <Badge variant="secondary" className="ml-1">student-only</Badge>
        </div>
        <div className="flex-1" />
        <div className="relative w-72 max-sm:hidden">
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search posts…"
            className="pl-9"
          />
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 opacity-60" />
        </div>
        {user ? (
          <div className="flex items-center gap-2">
            <Avatar className="h-8 w-8">
              <AvatarFallback>{initials(user.displayName || user.email)}</AvatarFallback>
            </Avatar>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon"><MoreHorizontal className="h-4 w-4" /></Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => logout()} className="gap-2"><LogOut className="h-4 w-4" />Log out</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function AuthGate() {
  const { user, loading, signInGoogle, signInEmail, signUpEmail } = useAuth();
  const [mode, setMode] = useState("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");

  if (loading) return <div className="p-10 text-center">Loading…</div>;
  if (user) return null;

  return (
    <div className="min-h-[60vh] grid place-items-center p-6">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-2xl font-bold">Welcome to ChalkBoard</CardTitle>
          <p className="text-sm text-muted-foreground">A private, student-run bulletin for your school.</p>
        </CardHeader>
        <CardContent className="space-y-3">
          {mode === "signup" && (
            <Input placeholder="Display name" value={name} onChange={(e) => setName(e.target.value)} />
          )}
          <Input placeholder="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          <Input placeholder="Password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
          <div className="flex gap-2">
            {mode === "signin" ? (
              <Button className="flex-1" onClick={() => signInEmail(email, password)}>Sign in</Button>
            ) : (
              <Button className="flex-1" onClick={() => signUpEmail(email, password, name || email.split("@")[0])}>Create account</Button>
            )}
            <Button variant="secondary" className="flex-1" onClick={signInGoogle}>Continue with Google</Button>
          </div>
          <Button variant="ghost" className="w-full" onClick={() => setMode(mode === "signin" ? "signup" : "signin")}>
            {mode === "signin" ? "No account? Create one" : "Have an account? Sign in"}
          </Button>
          <p className="text-xs text-muted-foreground">By continuing, you agree to keep ChalkBoard respectful. No doxxing, bullying, or spam. Mods can remove content.</p>
        </CardContent>
      </Card>
    </div>
  );
}

function CreatePost({ onCreated }) {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [imageUrl, setImageUrl] = useState("");

  const canPost = title.trim().length >= 4 && body.trim().length >= 1;

  const submit = async () => {
    if (!canPost) return;
    const id = await createPost({ title, body, imageUrl, user });
    setOpen(false);
    setTitle("");
    setBody("");
    setImageUrl("");
    toast.success("Posted to ChalkBoard");
    onCreated?.(id);
  };

  if (!user) return null;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="gap-2"><Plus className="h-4 w-4" /> New Post</Button>
      </DialogTrigger>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Create a post</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <Input maxLength={120} placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)} />
          <Textarea rows={6} placeholder="What's going on?" value={body} onChange={(e) => setBody(e.target.value)} />
          <Input placeholder="Optional image URL" value={imageUrl} onChange={(e) => setImageUrl(e.target.value)} />
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={submit} disabled={!canPost}>Post</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function VoteBar({ post }) {
  const { user } = useAuth();
  const [myVote, setMyVote] = useState(0);

  useEffect(() => {
    if (!user) return;
    const vRef = ref(db, `votes/posts/${post.id}/${user.uid}`);
    const handler = onValue(vRef, (snap) => setMyVote(snap.val() || 0));
    return () => off(vRef, "value", handler);
  }, [post.id, user]);

  const doVote = async (v) => {
    if (!user) return toast("Sign in to vote");
    const newVal = myVote === v ? 0 : v;
    setMyVote(newVal);
    await votePost({ postId: post.id, uid: user.uid, value: newVal });
  };

  return (
    <div className="flex items-center gap-2">
      <Button variant={myVote === 1 ? "default" : "secondary"} size="sm" onClick={() => doVote(1)} className="gap-1">
        <ThumbsUp className="h-4 w-4" /> {post.score || 0}
      </Button>
    </div>
  );
}

function PostCard({ post, onOpen }) {
  return (
    <Card className="hover:shadow-md transition-shadow">
      <CardContent className="p-4">
        <div className="flex gap-3">
          <Avatar className="h-8 w-8 shrink-0"><AvatarFallback>{initials(post.authorName)}</AvatarFallback></Avatar>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <span className="font-medium text-foreground">{post.authorName}</span>
              <span>•</span>
              <span>{timeAgo(post.createdAt)}</span>
            </div>
            <h3 className="font-semibold text-lg leading-snug mt-1 break-words">{post.title}</h3>
            {post.imageUrl ? (
              <img src={post.imageUrl} alt="" className="mt-2 rounded-xl max-h-80 w-full object-cover" />
            ) : null}
            <p className="mt-2 text-sm text-muted-foreground line-clamp-3 whitespace-pre-wrap">{post.body}</p>
            <div className="mt-3 flex items-center gap-3">
              <VoteBar post={post} />
              <Button variant="ghost" size="sm" className="gap-1" onClick={() => onOpen(post)}>
                <MessageCircle className="h-4 w-4" /> {post.commentCount || 0}
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon"><MoreHorizontal className="h-4 w-4" /></Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem className="gap-2" onClick={() => reportPost({ postId: post.id })}><Flag className="h-4 w-4" />Report</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function PostDetail({ open, onOpenChange, post }) {
  const { user } = useAuth();
  const comments = useComments(post?.id);
  const [text, setText] = useState("");

  const submit = async () => {
    if (!text.trim()) return;
    await createComment({ postId: post.id, text, user });
    setText("");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{post?.title}</DialogTitle>
          <div className="text-sm text-muted-foreground">by {post?.authorName} • {timeAgo(post?.createdAt)}</div>
        </DialogHeader>
        <div className="space-y-3">
          {post?.imageUrl ? <img src={post.imageUrl} alt="" className="rounded-xl max-h-96 w-full object-cover" /> : null}
          <p className="whitespace-pre-wrap">{post?.body}</p>
          <div className="flex items-center gap-3 pt-2 border-t">
            <VoteBar post={post} />
            <span className="text-sm text-muted-foreground">{post?.commentCount || 0} comments</span>
          </div>
          <div className="space-y-2">
            {comments.map((c) => (
              <div key={c.id} className="flex gap-3">
                <Avatar className="h-7 w-7"><AvatarFallback>{initials(c.authorName)}</AvatarFallback></Avatar>
                <div>
                  <div className="text-xs text-muted-foreground">{c.authorName} • {timeAgo(c.createdAt)}</div>
                  <div className="text-sm whitespace-pre-wrap">{c.text}</div>
                </div>
              </div>
            ))}
          </div>
          {user ? (
            <div className="flex gap-2 pt-2">
              <Textarea rows={3} placeholder="Write a comment…" value={text} onChange={(e) => setText(e.target.value)} />
              <Button onClick={submit}>Send</Button>
            </div>
          ) : (
            <div className="text-sm text-muted-foreground">Sign in to comment.</div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Feed() {
  const posts = usePosts();
  const [selected, setSelected] = useState(null);
  const [tab, setTab] = useState("new");
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    let arr = posts;
    if (query.trim()) {
      const q = query.toLowerCase();
      arr = arr.filter((p) => p.title.toLowerCase().includes(q) || p.body.toLowerCase().includes(q));
    }
    if (tab === "top") arr = [...arr].sort((a, b) => (b.score || 0) - (a.score || 0));
    if (tab === "new") arr = [...arr].sort((a, b) => b.createdAt - a.createdAt);
    return arr;
  }, [posts, tab, query]);

  return (
    <div className="max-w-4xl mx-auto p-3">
      <Header query={query} setQuery={setQuery} />
      <div className="flex items-center justify-between mt-4">
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="new" className="gap-1"><Clock className="h-4 w-4" />New</TabsTrigger>
            <TabsTrigger value="top" className="gap-1"><Star className="h-4 w-4" />Top</TabsTrigger>
          </TabsList>
        </Tabs>
        <CreatePost onCreated={(id) => {
          // Optionally open the post after creation
          const p = posts.find((x) => x.id === id);
          if (p) setSelected(p);
        }} />
      </div>

      <div className="mt-4 grid gap-3">
        {filtered.map((p) => (
          <PostCard key={p.id} post={p} onOpen={(post) => setSelected(post)} />
        ))}
        {!filtered.length && (
          <Card><CardContent className="p-6 text-sm text-muted-foreground">No posts yet. Be the first to write something!</CardContent></Card>
        )}
      </div>

      <PostDetail open={!!selected} onOpenChange={(v) => !v && setSelected(null)} post={selected} />
    </div>
  );
}

// =========================
// Root
// =========================
export default function ChalkBoardApp() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-neutral-50 to-white">
      <div className="py-6">
        <AuthProvider>
          <AuthGate />
          <MainApp />
        </AuthProvider>
      </div>
    </div>
  );
}

function MainApp() {
  const { user } = useAuth();
  if (!user) return null;
  return <Feed />;
}

// =========================
// Notes / Database Rules (configure in Firebase console):
//
// {
//   "rules": {
//     ".read": "auth != null",
//     ".write": "auth != null",
//     "posts": {
//       ".indexOn": ["createdAt", "score"]
//     },
//     "votes": {
//       "posts": {
//         "$post": {
//           "$uid": { 
//             ".write": "$uid === auth.uid" 
//           }
//         }
//       }
//     }
//   }
// }
//
// Deploy steps (summary):
// 1) firebase init hosting (select existing project chalkboard-a4236) and choose GitHub Actions for CI.
// 2) Ensure your build outputs index.html that loads this component (e.g., Vite/Next). Canvas preview supports it directly.
// 3) Add Realtime Database in Firebase console and paste the rules above (adjust as needed).
