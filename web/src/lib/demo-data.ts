/**
 * Demo mode mock data and API response routing.
 * When NEXT_PUBLIC_DEMO_MODE=true or MONGODB_URI is unset, the middleware
 * intercepts every /api/* request and routes it here instead of hitting
 * real database-backed route handlers.
 */

// ─── Helper: today/yesterday date strings ───
function today(): string {
  return new Date().toISOString().split("T")[0];
}
function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().split("T")[0];
}

// ─── Mock Users ───
const DEMO_PATIENT = {
  id: "demo_patient_001",
  name: "Alex Rivera",
  username: "alex_demo",
  role: "patient" as const,
  hasTherapist: true,
  notificationCount: 1,
  voiceId: "EXAVITQu4vr4xnSDxMaL",
};

const DEMO_THERAPIST = {
  id: "demo_therapist_001",
  name: "Dr. Sarah Chen",
  username: "dr_chen",
  role: "therapist" as const,
  hasTherapist: false,
  notificationCount: 0,
  voiceId: "EXAVITQu4vr4xnSDxMaL",
};

const DEMO_PATIENT_2 = {
  id: "demo_patient_002",
  name: "Jordan Kim",
  username: "jordan_demo",
  role: "patient" as const,
};

// ─── Mock Exercises (mirrors seed-exercises) ───
const DEMO_EXERCISES = [
  {
    _id: "demo_ex_001",
    name: "Shoulder Raise",
    description: "Raise your arm out to the side, keeping it straight.",
    category: "upper body",
    defaultSets: 3,
    defaultReps: 10,
    defaultHoldSec: 0,
    exerciseKey: "arm_abduction",
    skeletonDataFile: "ex1_reference.json",
    createdAt: daysAgo(30),
  },
  {
    _id: "demo_ex_002",
    name: "Arm VW Raise",
    description: "Raise both arms in a V-W pattern above your head.",
    category: "upper body",
    defaultSets: 3,
    defaultReps: 10,
    defaultHoldSec: 0,
    exerciseKey: "arm_vw",
    skeletonDataFile: "ex2_reference.json",
    createdAt: daysAgo(30),
  },
  {
    _id: "demo_ex_003",
    name: "Squat",
    description: "Stand with feet shoulder-width apart. Lower your body by bending your knees.",
    category: "lower body",
    defaultSets: 3,
    defaultReps: 10,
    defaultHoldSec: 0,
    exerciseKey: "squat",
    skeletonDataFile: "ex6_reference.json",
    createdAt: daysAgo(30),
  },
  {
    _id: "demo_ex_004",
    name: "Leg Abduction",
    description: "Stand on one leg and raise the other leg out to the side.",
    category: "lower body",
    defaultSets: 3,
    defaultReps: 10,
    defaultHoldSec: 0,
    exerciseKey: "leg_abduction",
    skeletonDataFile: "ex4_reference.json",
    createdAt: daysAgo(30),
  },
];

// ─── Mock Assignments ───
function makeTodayAssignment(userId: string) {
  return {
    _id: "demo_assign_today",
    userId,
    date: today(),
    allCompleted: false,
    exercises: [
      {
        exerciseId: "demo_ex_001",
        exerciseName: "Shoulder Raise",
        sets: 3,
        reps: 10,
        holdSec: 0,
        completed: true,
        exerciseKey: "arm_abduction",
        skeletonDataFile: "ex1_reference.json",
      },
      {
        exerciseId: "demo_ex_002",
        exerciseName: "Arm VW Raise",
        sets: 3,
        reps: 10,
        holdSec: 0,
        completed: true,
        exerciseKey: "arm_vw",
        skeletonDataFile: "ex2_reference.json",
      },
      {
        exerciseId: "demo_ex_003",
        exerciseName: "Squat",
        sets: 3,
        reps: 10,
        holdSec: 0,
        completed: false,
        exerciseKey: "squat",
        skeletonDataFile: "ex6_reference.json",
      },
      {
        exerciseId: "demo_ex_004",
        exerciseName: "Leg Abduction",
        sets: 3,
        reps: 10,
        holdSec: 0,
        completed: false,
        exerciseKey: "leg_abduction",
        skeletonDataFile: "ex4_reference.json",
      },
    ],
    createdAt: today(),
  };
}

function makePastAssignments(userId: string) {
  return [
    {
      _id: "demo_assign_past_1",
      userId,
      date: daysAgo(1),
      allCompleted: true,
      exercises: [
        { exerciseId: "demo_ex_001", exerciseName: "Shoulder Raise", sets: 3, reps: 10, holdSec: 0, completed: true, exerciseKey: "arm_abduction", skeletonDataFile: "ex1_reference.json" },
        { exerciseId: "demo_ex_003", exerciseName: "Squat", sets: 3, reps: 10, holdSec: 0, completed: true, exerciseKey: "squat", skeletonDataFile: "ex6_reference.json" },
      ],
      createdAt: daysAgo(1),
    },
    {
      _id: "demo_assign_past_2",
      userId,
      date: daysAgo(2),
      allCompleted: true,
      exercises: [
        { exerciseId: "demo_ex_002", exerciseName: "Arm VW Raise", sets: 3, reps: 10, holdSec: 0, completed: true, exerciseKey: "arm_vw", skeletonDataFile: "ex2_reference.json" },
        { exerciseId: "demo_ex_004", exerciseName: "Leg Abduction", sets: 3, reps: 10, holdSec: 0, completed: true, exerciseKey: "leg_abduction", skeletonDataFile: "ex4_reference.json" },
      ],
      createdAt: daysAgo(2),
    },
  ];
}

// ─── Mock Streak ───
const DEMO_STREAK = {
  currentStreak: 5,
  longestStreak: 12,
  lastCompletedDate: today(),
  history: Array.from({ length: 12 }, (_, i) => daysAgo(11 - i)),
};

// ─── Mock Messages ───
function makeDemoMessages(myId: string, partnerId: string) {
  const now = Date.now();
  return [
    { _id: "msg_001", senderId: partnerId, receiverId: myId, content: "Hi Alex! How are the exercises going today?", read: true, createdAt: new Date(now - 3600000 * 4).toISOString(), isMine: false },
    { _id: "msg_002", senderId: myId, receiverId: partnerId, content: "Pretty good! The shoulder raises are getting easier.", read: true, createdAt: new Date(now - 3600000 * 3.5).toISOString(), isMine: true },
    { _id: "msg_003", senderId: partnerId, receiverId: myId, content: "That's great progress! Remember to keep your core engaged during squats.", read: true, createdAt: new Date(now - 3600000 * 3).toISOString(), isMine: false },
    { _id: "msg_004", senderId: myId, receiverId: partnerId, content: "Will do! The coaching arrows really help me correct my form.", read: true, createdAt: new Date(now - 3600000 * 2).toISOString(), isMine: true },
    { _id: "msg_005", senderId: partnerId, receiverId: myId, content: "Perfect. I've assigned your exercises for today. Keep up the great work! 💪", read: false, createdAt: new Date(now - 3600000).toISOString(), isMine: false },
  ];
}

// ─── Mock Exercise Session (for ExerciseReport) ───
function makeDemoSession() {
  const repTimestamps = Array.from({ length: 10 }, (_, i) => (i + 1) * 4500);
  const rmsHistory = Array.from({ length: 20 }, (_, i) => ({
    timeSec: i * 2.5,
    rms: Math.max(0.01, 0.12 - i * 0.005 + Math.random() * 0.02),
  }));

  return {
    _id: "demo_session_001",
    userId: "demo_patient_001",
    assignmentId: "demo_assign_today",
    exerciseId: "demo_ex_003",
    exerciseName: "Squat",
    exerciseKey: "squat",
    sets: 3,
    reps: 10,
    completedReps: 10,
    durationMs: 45000,
    repTimestamps,
    painEvents: [],
    formDistribution: { good: 15, warning: 3, neutral: 2 },
    rmsHistory,
    coachingInterventions: [
      { timeSec: 8.5, text: "Keep your back straighter" },
      { timeSec: 22.0, text: "Good improvement! Knees tracking over toes now" },
    ],
    createdAt: new Date().toISOString(),
  };
}

// ─── Mock Invites (therapist view) ───
const DEMO_INVITES = [
  {
    _id: "demo_invite_001",
    therapistId: "demo_therapist_001",
    therapistName: "Dr. Sarah Chen",
    patientId: "demo_patient_003",
    patientUsername: "sam_wilson",
    status: "pending",
    createdAt: daysAgo(1),
  },
];

// ─── Mock Notifications ───
function getDemoNotifications(role: string) {
  if (role === "patient") {
    return [
      {
        _id: "demo_notif_001",
        type: "invite",
        therapistName: "Dr. Sarah Chen",
        createdAt: daysAgo(0),
      },
    ];
  }
  return [
    {
      _id: "demo_notif_002",
      type: "accepted",
      patientUsername: "alex_demo",
      createdAt: daysAgo(1),
    },
  ];
}

// ─── Mock Patients (therapist view) ───
const DEMO_PATIENTS_LIST = [
  {
    _id: "demo_patient_001",
    name: "Alex Rivera",
    username: "alex_demo",
    role: "patient",
    streak: { currentStreak: 5, longestStreak: 12 },
    createdAt: daysAgo(30),
  },
  {
    _id: "demo_patient_002",
    name: "Jordan Kim",
    username: "jordan_demo",
    role: "patient",
    streak: { currentStreak: 2, longestStreak: 8 },
    createdAt: daysAgo(20),
  },
];

// ─── Session cookie shape ───
export interface DemoSession {
  role: "patient" | "therapist";
  name: string;
  username: string;
}

// ─── Response shape ───
export interface DemoResponse {
  status: number;
  body: unknown;
  setCookie?: { name: string; value: string; options?: Record<string, unknown> };
  clearCookies?: string[];
}

// ─── Main router ───
export function getDemoResponse(
  method: string,
  pathname: string,
  searchParams: URLSearchParams,
  requestBody: unknown,
  session: DemoSession | null,
): DemoResponse {
  const body = requestBody as Record<string, unknown> | null;

  // Helper to get user based on session
  function getUser() {
    if (!session) return null;
    return session.role === "therapist" ? DEMO_THERAPIST : DEMO_PATIENT;
  }

  function getUserId() {
    const u = getUser();
    return u?.id ?? "demo_patient_001";
  }

  // ─── Auth Routes ───

  // POST /api/auth/login
  if (pathname === "/api/auth/login" && method === "POST") {
    const username = (body?.username as string) || "demo";
    const isTherapist = username.toLowerCase().includes("therapist") || username.toLowerCase().includes("dr_chen") || username.toLowerCase().includes("dr chen");
    const role = isTherapist ? "therapist" : "patient";
    const user = isTherapist ? DEMO_THERAPIST : DEMO_PATIENT;

    const sessionData: DemoSession = { role, name: user.name, username: user.username };

    return {
      status: 200,
      body: {
        success: true,
        user: { id: user.id, username: user.username, name: user.name, role },
      },
      setCookie: {
        name: "demo_session",
        value: JSON.stringify(sessionData),
        options: { path: "/", maxAge: 60 * 60 * 24 * 7 },
      },
    };
  }

  // POST /api/auth/register
  if (pathname === "/api/auth/register" && method === "POST") {
    const username = (body?.username as string) || "demo_new";
    const name = (body?.name as string) || "Demo User";
    const role = (body?.role as string) === "therapist" ? "therapist" : "patient";
    const user = role === "therapist" ? DEMO_THERAPIST : DEMO_PATIENT;

    const sessionData: DemoSession = { role: role as "patient" | "therapist", name, username };

    return {
      status: 200,
      body: { success: true, userId: user.id },
      setCookie: {
        name: "demo_session",
        value: JSON.stringify(sessionData),
        options: { path: "/", maxAge: 60 * 60 * 24 * 7 },
      },
    };
  }

  // GET /api/auth/me
  if (pathname === "/api/auth/me" && method === "GET") {
    if (!session) {
      return { status: 401, body: { error: "Not authenticated" } };
    }
    const user = getUser()!;
    return {
      status: 200,
      body: {
        user: {
          id: user.id,
          username: user.username,
          name: user.name,
          role: user.role,
          hasTherapist: user.role === "patient",
          notificationCount: user.role === "patient" ? 1 : 0,
          voiceId: "EXAVITQu4vr4xnSDxMaL",
        },
        streak: {
          currentStreak: DEMO_STREAK.currentStreak,
          longestStreak: DEMO_STREAK.longestStreak,
          lastCompletedDate: DEMO_STREAK.lastCompletedDate,
        },
      },
    };
  }

  // POST /api/auth/logout
  if (pathname === "/api/auth/logout" && method === "POST") {
    return {
      status: 200,
      body: { success: true },
      clearCookies: ["demo_session", "pt_session"],
    };
  }

  // PATCH /api/auth/profile
  if (pathname === "/api/auth/profile" && method === "PATCH") {
    if (!session) return { status: 401, body: { error: "Not authenticated" } };
    return { status: 200, body: { success: true } };
  }

  // PATCH /api/auth/voice
  if (pathname === "/api/auth/voice" && method === "PATCH") {
    if (!session) return { status: 401, body: { error: "Not authenticated" } };
    return { status: 200, body: { success: true } };
  }

  // DELETE /api/auth/delete-account
  if (pathname === "/api/auth/delete-account" && method === "DELETE") {
    return {
      status: 200,
      body: { success: true },
      clearCookies: ["demo_session", "pt_session"],
    };
  }

  // ─── Exercises ───

  // GET /api/exercises
  if (pathname === "/api/exercises" && method === "GET") {
    if (!session) return { status: 401, body: { error: "Not authenticated" } };
    return { status: 200, body: { exercises: DEMO_EXERCISES } };
  }

  // ─── Assignments ───

  // POST /api/assignments/*/complete
  const completeMatch = pathname.match(/^\/api\/assignments\/([^/]+)\/complete$/);
  if (completeMatch && method === "POST") {
    if (!session) return { status: 401, body: { error: "Not authenticated" } };
    const todayAssign = makeTodayAssignment(getUserId());
    // Mark the requested exercise as completed in the mock
    const exerciseId = (body?.exerciseId as string) || "";
    const exercises = todayAssign.exercises.map((ex) => ({
      ...ex,
      completed: ex.completed || ex.exerciseId === exerciseId,
    }));
    const allCompleted = exercises.every((ex) => ex.completed);

    return {
      status: 200,
      body: {
        success: true,
        allCompleted,
        exercises,
        streak: allCompleted
          ? { currentStreak: DEMO_STREAK.currentStreak + 1, longestStreak: DEMO_STREAK.longestStreak }
          : null,
      },
    };
  }

  // GET/POST /api/assignments
  if (pathname === "/api/assignments") {
    if (!session) return { status: 401, body: { error: "Not authenticated" } };

    if (method === "POST") {
      return { status: 200, body: { success: true, id: "demo_assign_new" } };
    }

    // GET
    const view = searchParams.get("view");
    const userId = searchParams.get("userId") || getUserId();

    if (view === "today") {
      return { status: 200, body: { assignment: makeTodayAssignment(userId) } };
    }
    if (view === "incomplete") {
      return { status: 200, body: { assignments: [makeTodayAssignment(userId)] } };
    }
    if (view === "past") {
      return { status: 200, body: { assignments: makePastAssignments(userId) } };
    }
    return {
      status: 200,
      body: { assignments: [makeTodayAssignment(userId), ...makePastAssignments(userId)] },
    };
  }

  // ─── Streaks ───

  if (pathname === "/api/streaks" && method === "GET") {
    if (!session) return { status: 401, body: { error: "Not authenticated" } };
    const todayAssign = makeTodayAssignment(getUserId());
    return {
      status: 200,
      body: {
        streak: DEMO_STREAK,
        todayProgress: {
          total: todayAssign.exercises.length,
          completed: todayAssign.exercises.filter((e) => e.completed).length,
          allDone: todayAssign.allCompleted,
        },
      },
    };
  }

  // ─── Patients ───

  // GET /api/patients/*/activity
  const patientActivityMatch = pathname.match(/^\/api\/patients\/([^/]+)\/activity$/);
  if (patientActivityMatch && method === "GET") {
    if (!session || session.role !== "therapist") return { status: 401, body: { error: "Unauthorized" } };

    return {
      status: 200,
      body: {
        sessions: [{ ...makeDemoSession(), _id: "demo_session_001" }],
        assignments: [makeTodayAssignment("demo_patient_001"), ...makePastAssignments("demo_patient_001")].map((a) => ({
          ...a,
          _id: a._id,
        })),
        streak: DEMO_STREAK,
      },
    };
  }

  // GET /api/patients/*/assignments
  const patientAssignMatch = pathname.match(/^\/api\/patients\/([^/]+)\/assignments$/);
  if (patientAssignMatch && method === "GET") {
    if (!session || session.role !== "therapist") return { status: 401, body: { error: "Unauthorized" } };
    const pid = patientAssignMatch[1];
    return {
      status: 200,
      body: { assignments: [makeTodayAssignment(pid), ...makePastAssignments(pid)] },
    };
  }

  // GET /api/patients/:id
  const patientDetailMatch = pathname.match(/^\/api\/patients\/([^/]+)$/);
  if (patientDetailMatch && method === "GET") {
    if (!session || session.role !== "therapist") return { status: 401, body: { error: "Unauthorized" } };
    const pid = patientDetailMatch[1];
    const patient = DEMO_PATIENTS_LIST.find((p) => p._id === pid) || DEMO_PATIENTS_LIST[0];
    const userId = patient._id;

    return {
      status: 200,
      body: {
        patient: {
          _id: patient._id,
          name: patient.name,
          username: patient.username,
          role: patient.role,
          createdAt: patient.createdAt,
        },
        todayAssignment: makeTodayAssignment(userId),
        history: [makeTodayAssignment(userId), ...makePastAssignments(userId)].map((a) => ({
          _id: a._id,
          date: a.date,
          exercises: a.exercises,
          allCompleted: a.allCompleted,
        })),
      },
    };
  }

  // GET /api/patients
  if (pathname === "/api/patients" && method === "GET") {
    if (!session || session.role !== "therapist") return { status: 401, body: { error: "Unauthorized" } };
    return { status: 200, body: { patients: DEMO_PATIENTS_LIST } };
  }

  // ─── Invites ───

  // DELETE /api/invites/:token
  const inviteDeleteMatch = pathname.match(/^\/api\/invites\/([^/]+)$/);
  if (inviteDeleteMatch && method === "DELETE") {
    if (!session) return { status: 401, body: { error: "Unauthorized" } };
    return { status: 200, body: { success: true } };
  }

  // GET/POST /api/invites
  if (pathname === "/api/invites") {
    if (!session || session.role !== "therapist") return { status: 401, body: { error: "Unauthorized" } };
    if (method === "POST") {
      return { status: 200, body: { success: true } };
    }
    return { status: 200, body: { invites: DEMO_INVITES } };
  }

  // ─── Relationships ───

  const relationshipMatch = pathname.match(/^\/api\/relationships\/([^/]+)$/);
  if (relationshipMatch && method === "DELETE") {
    if (!session) return { status: 401, body: { error: "Unauthorized" } };
    return { status: 200, body: { success: true } };
  }

  // ─── Notifications ───

  // POST /api/notifications/*/respond
  const notifRespondMatch = pathname.match(/^\/api\/notifications\/([^/]+)\/respond$/);
  if (notifRespondMatch && method === "POST") {
    if (!session) return { status: 401, body: { error: "Unauthorized" } };
    return { status: 200, body: { success: true } };
  }

  // GET /api/notifications
  if (pathname === "/api/notifications" && method === "GET") {
    if (!session) return { status: 401, body: { error: "Unauthorized" } };
    const countOnly = searchParams.get("count") === "true";
    if (countOnly) {
      return { status: 200, body: { count: session.role === "patient" ? 1 : 0 } };
    }
    return { status: 200, body: { notifications: getDemoNotifications(session.role) } };
  }

  // ─── Messages ───

  // GET /api/messages/:userId
  const messagesDetailMatch = pathname.match(/^\/api\/messages\/([^/]+)$/);
  if (messagesDetailMatch && method === "GET") {
    if (!session) return { status: 401, body: { error: "Unauthorized" } };
    const partnerId = messagesDetailMatch[1];
    const myId = getUserId();
    const msgs = makeDemoMessages(myId, partnerId).map((m) => ({
      ...m,
      isMine: m.senderId === myId,
    }));
    return { status: 200, body: { messages: msgs } };
  }

  // GET/POST /api/messages
  if (pathname === "/api/messages") {
    if (!session) return { status: 401, body: { error: "Unauthorized" } };

    if (method === "POST") {
      return { status: 200, body: { success: true, messageId: "demo_msg_new" } };
    }

    // GET — conversation list
    const userId = getUserId();
    if (session.role === "patient") {
      return {
        status: 200,
        body: {
          conversations: [
            {
              partnerId: DEMO_THERAPIST.id,
              partnerName: DEMO_THERAPIST.name,
              partnerRole: "therapist",
              lastMessage: "Perfect. I've assigned your exercises for today. Keep up the great work! 💪",
              unreadCount: 1,
            },
          ],
        },
      };
    }
    // Therapist
    return {
      status: 200,
      body: {
        conversations: DEMO_PATIENTS_LIST.map((p, i) => ({
          partnerId: p._id,
          partnerName: p.name,
          partnerRole: "patient",
          lastMessage: i === 0
            ? "Will do! The coaching arrows really help me correct my form."
            : null,
          unreadCount: i === 0 ? 1 : 0,
        })),
      },
    };
  }

  // ─── Exercise Sessions ───

  if (pathname === "/api/exercise-sessions") {
    if (!session) return { status: 401, body: { error: "Not authenticated" } };

    if (method === "POST") {
      return { status: 200, body: { sessionId: "demo_session_001" } };
    }

    // GET
    const id = searchParams.get("id");
    if (id) {
      return { status: 200, body: { session: makeDemoSession() } };
    }
    return { status: 200, body: { sessions: [makeDemoSession()] } };
  }

  // ─── TTS (unavailable in demo) ───

  if (pathname.startsWith("/api/tts")) {
    return { status: 503, body: { error: "TTS is unavailable in demo mode" } };
  }

  // ─── Dev routes ───

  if (pathname.startsWith("/api/dev")) {
    return { status: 200, body: { success: true, demo: true } };
  }

  // ─── Fallback ───
  return { status: 200, body: { success: true, demo: true } };
}
