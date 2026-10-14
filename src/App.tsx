import { useEffect, useMemo, useState } from "react";
import { MuscleAtlas, type AtlasItem } from './MuscleAtlas';
import { onAuthStateChanged, updateEmail, updatePassword, updateProfile, type User } from "firebase/auth";
import {
  collection,
  doc,
  getDoc,
  setDoc,
  serverTimestamp,
  writeBatch,
} from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import * as Dialog from "@radix-ui/react-dialog";
import * as AlertDialog from "@radix-ui/react-alert-dialog";
import {
  Activity,
  ArrowLeft,
  BarChart3,
  Bell,
  BookOpen,
  CalendarDays,
  Check,
  ChevronRight,
  CircleAlert,
  Clock3,
  Dumbbell,
  Flame,
  Home,
  LogOut,
  Menu,
  MoreHorizontal,
  Play,
  Pencil,
  Plus,
  Search,
  Share2,
  Settings,
  Sparkles,
  TimerReset,
  Trash2,
  RotateCcw,
  Upload,
  UserRound,
  UsersRound,
  X,
} from "lucide-react";
import { workout as seedWorkout } from "./data";
import type { Effort, Exercise, Role, Workout } from "./types";
import { parseWorkoutText } from "./lib/importProgram";
import {
  catalogImage,
  catalogSource,
  findCatalogExercise,
  type CatalogExercise,
} from "./lib/exerciseCatalog";
import { extractWorkoutText } from "./lib/fileImport";
import { analyzeWorkoutWithAi, type AiWorkoutImport } from "./lib/aiImport";
import { importWasCorrected, loadSimilarImportCorrections } from "./lib/importLearning";
import { firebaseAuth, firebaseFunctions, firestore } from "./lib/firebase";
import {
  acceptCoachInvite, addClientNote, addProgramBlock, addProgramExercise,
  assignProgram, createCoachInvite, createProgram, createProgramWorkout,
  deactivateAssignment, endCoaching as endFirebaseCoaching, loadClientDetails, loadCoachClients,
  loadProgramEditor, loadPrograms, loadRecentLogs, replaceProgramExercises,
} from "./lib/firebaseCoach";
import {
  deleteFirebaseWorkout,
  loadFirebaseProgress,
  loadFirebaseWorkouts,
  loadNextFirebaseWorkout,
  saveFirebaseWorkout,
  updateFirebaseWorkout,
  createWorkoutShare,
  loadWorkoutShare,
  acceptWorkoutShare,
  type WorkoutListItem,
} from "./lib/firestoreWorkouts";

type AppSession = { user: User & { user_metadata?: Record<string, unknown> } };

function stripUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined),
  ) as T;
}

function isBodyweightExercise(name: string) {
  return /traction|pull[- ]?up|chin[- ]?up|dips?|pompe|push[- ]?up|muscle[- ]?up|gainage|planche/i.test(
    name,
  );
}

const frenchMuscles: Record<string, string> = {
  abdominals: "abdominaux",
  abductor: "abducteurs",
  adductors: "adducteurs",
  biceps: "biceps",
  calves: "mollets",
  chest: "pectoraux",
  forearms: "avant-bras",
  glutes: "fessiers",
  hamstrings: "ischio-jambiers",
  lats: "dorsaux",
  lower: "bas du dos",
  middle: "milieu du dos",
  neck: "cou",
  quadriceps: "quadriceps",
  shoulders: "épaules",
  traps: "trapèzes",
  triceps: "triceps",
  back: "dos",
  "full body": "corps entier",
};
const frenchEquipment: Record<string, string> = {
  "body only": "poids du corps",
  barbell: "barre",
  dumbbell: "haltères",
  machine: "machine",
  cable: "poulie",
  kettlebells: "kettlebell",
  "foam roll": "rouleau de massage",
  bands: "élastiques",
  other: "autre",
  exercise: "sans matériel",
};
function frenchLabel(
  value: string | null | undefined,
  map: Record<string, string>,
  fallback: string,
) {
  return value ? (map[value.toLowerCase()] ?? value) : fallback;
}
function frenchGuideInstructions(exercise: CatalogExercise) {
  const muscles =
    exercise.primaryMuscles
      ?.map((muscle) => frenchLabel(muscle, frenchMuscles, muscle))
      .join(" et ") || "la zone ciblée";
  const equipment = frenchLabel(
    exercise.equipment,
    frenchEquipment,
    "le matériel adapté",
  );
  return [
    `Installez-vous avec ${equipment} et adoptez une position stable.`,
    `Placez votre corps pour cibler principalement ${muscles}, en gardant la colonne et les articulations dans une position confortable.`,
    "Réalisez le mouvement lentement et de manière contrôlée, sans à-coups ni élan.",
    "Respirez régulièrement et arrêtez-vous en cas de douleur inhabituelle. Adaptez l’amplitude et la charge à votre niveau.",
  ];
}

type MuscleZone =
  | "pectoraux" | "épaules" | "biceps" | "triceps" | "avant-bras"
  | "abdominaux" | "dorsaux" | "trapèzes" | "lombaires" | "fessiers"
  | "quadriceps" | "ischio-jambiers" | "adducteurs" | "mollets";

const muscleZoneLabels: Record<MuscleZone, string> = {
  pectoraux: "Pectoraux", épaules: "Épaules", biceps: "Biceps",
  triceps: "Triceps", "avant-bras": "Avant-bras", abdominaux: "Abdominaux",
  dorsaux: "Dorsaux", trapèzes: "Trapèzes", lombaires: "Lombaires",
  fessiers: "Fessiers", quadriceps: "Quadriceps",
  "ischio-jambiers": "Ischio-jambiers", adducteurs: "Adducteurs", mollets: "Mollets",
};

function normalizeMuscleText(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function inferExerciseMuscles(exercise: Exercise): { primary: MuscleZone[]; secondary: MuscleZone[] } {
  const text = normalizeMuscleText(`${exercise.name} ${exercise.muscle}`);
  const has = (pattern: RegExp) => pattern.test(text);
  if (has(/squat|presse a cuisse|leg press|leg extension|fente|lunge/))
    return { primary: ["quadriceps"], secondary: ["fessiers", "adducteurs", "ischio-jambiers"] };
  if (has(/hip thrust|glute|fessier|abduction/))
    return { primary: ["fessiers"], secondary: ["ischio-jambiers", "adducteurs"] };
  if (has(/leg curl|ischio|hamstring|souleve de terre|deadlift/))
    return { primary: ["ischio-jambiers", "fessiers"], secondary: ["lombaires", "dorsaux"] };
  if (has(/mollet|calf/)) return { primary: ["mollets"], secondary: [] };
  if (has(/adduct/)) return { primary: ["adducteurs"], secondary: ["fessiers"] };
  if (has(/developpe couche|bench press|chest press|ecarte|fly|pompe|push-up|pector/))
    return { primary: ["pectoraux"], secondary: ["triceps", "épaules"] };
  if (has(/developpe militaire|shoulder press|overhead press|elevation laterale|lateral raise|epaule|deltoid/))
    return { primary: ["épaules"], secondary: ["triceps", "trapèzes"] };
  if (has(/traction|pull-up|chin-up|tirage|rowing|row|dorsal|lat pulldown/))
    return { primary: ["dorsaux"], secondary: ["biceps", "trapèzes", "avant-bras"] };
  if (has(/shrug|trapez/)) return { primary: ["trapèzes"], secondary: ["épaules"] };
  if (has(/curl|biceps/)) return { primary: ["biceps"], secondary: ["avant-bras"] };
  if (has(/triceps|pushdown|extension.*bras|dips/))
    return { primary: ["triceps"], secondary: ["pectoraux", "épaules"] };
  if (has(/avant-bras|forearm|poignet|wrist/)) return { primary: ["avant-bras"], secondary: ["biceps"] };
  if (has(/abdo|crunch|gainage|plank|sit-up|core/))
    return { primary: ["abdominaux"], secondary: ["lombaires"] };
  const direct = (Object.keys(muscleZoneLabels) as MuscleZone[]).find((zone) =>
    text.includes(normalizeMuscleText(zone)),
  );
  return direct ? { primary: [direct], secondary: [] } : { primary: [], secondary: [] };
}

function WorkoutMuscleMap({ exercises, selected, onSelect }: { exercises: Exercise[]; selected: MuscleZone | null; onSelect: (zone: MuscleZone | null) => void }) {
  const items: AtlasItem[] = [];
  for (const zone of Object.keys(muscleZoneLabels) as MuscleZone[]) {
    const matches = exercises.map(inferExerciseMuscles).filter(m => m.primary.includes(zone) || m.secondary.includes(zone));
    if (matches.length) items.push({ zone, primary: matches.some(m => m.primary.includes(zone)), count: matches.length });
  }
  return <MuscleAtlas items={items} selected={selected} onSelect={onSelect} />;
}

type Screen =
  | "home"
  | "sessions"
  | "workout"
  | "tools"
  | "guide"
  | "progress"
  | "clients"
  | "client-detail"
  | "programs"
  | "program-detail"
  | "profile";

function App() {
  const [role, setRole] = useState<Role | null>(null);
  const [session, setSession] = useState<AppSession | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [demoMode, setDemoMode] = useState(false);
  const [screen, setScreen] = useState<Screen>("home");
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [workout, setWorkout] = useState<Workout>(seedWorkout);
  const [active, setActive] = useState(false);
  const [workoutPaused, setWorkoutPaused] = useState(false);
  const [workoutElapsedSeconds, setWorkoutElapsedSeconds] = useState(0);
  const [activeRestoreReady, setActiveRestoreReady] = useState(false);
  const [effort, setEffort] = useState<Effort | null>(null);
  const [toast, setToast] = useState("");
  const [importOpen, setImportOpen] = useState(false);
  const [toolPreset, setToolPreset] = useState<ToolPreset | null>(null);
  const [selectedClientId, setSelectedClientId] = useState("");
  const [selectedProgramId, setSelectedProgramId] = useState("");
  const completed = workout.exercises.reduce((n, e) => n + e.done, 0);
  const total = workout.exercises.reduce((n, e) => n + e.sets, 0);
  const displayName =
    session?.user.displayName ||
    (session?.user.user_metadata?.display_name as string | undefined) ||
    session?.user.email?.split("@")[0] ||
    (role === "coach" ? "Coach" : "Membre");
  const initials = displayName
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  const notify = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(""), 2400);
  };
  const chooseRole = async (nextRole: Role) => {
    if (session && !demoMode) {
      try {
        await setDoc(
          doc(firestore, "profiles", session.user.uid),
          {
            display_name:
              session.user.displayName ??
              session.user.email?.split("@")[0] ??
              "Membre",
            email: session.user.email ?? null,
            role: nextRole,
            created_at: serverTimestamp(),
          },
          { merge: true },
        );
      } catch (error) {
        notify(
          error instanceof Error
            ? error.message
            : "Impossible d’enregistrer votre choix.",
        );
        return;
      }
    }
    setRole(nextRole);
    setScreen("home");
  };

  const signOut = async () => {
    await firebaseAuth.signOut();
    setSession(null);
    setRole(null);
    setDemoMode(false);
    setScreen("home");
  };

  useEffect(() => {
    const applySession = async (next: User | null) => {
      setSession(next ? { user: next as AppSession["user"] } : null);
      if (!next) {
        setRole(null);
        setAuthReady(true);
        return;
      }
      try {
        const profile = await getDoc(doc(firestore, "profiles", next.uid));
        setRole((profile.data()?.role as Role | undefined) ?? null);
      } catch (error) {
        console.error("Impossible de charger le profil Firebase", error);
        setRole(null);
      }
      setAuthReady(true);
    };
    return onAuthStateChanged(firebaseAuth, (next) => void applySession(next));
  }, []);

  useEffect(() => {
    if (!session || !role || role === "coach") return;
    const storageKey = `repflow-active-workout:${session.user.uid}`;
    try {
      const saved = window.localStorage.getItem(storageKey);
      if (saved) {
        const restored = JSON.parse(saved) as {
          workout: Workout;
          paused: boolean;
          elapsedSeconds: number;
          savedAt: number;
        };
        if (restored.workout?.id) {
          const offlineSeconds = restored.paused
            ? 0
            : Math.max(0, Math.floor((Date.now() - restored.savedAt) / 1000));
          setWorkout(restored.workout);
          setWorkoutPaused(restored.paused);
          setWorkoutElapsedSeconds(restored.elapsedSeconds + offlineSeconds);
          setActive(true);
          setActiveRestoreReady(true);
          return;
        }
      }
    } catch {
      window.localStorage.removeItem(storageKey);
    }
    (session
      ? loadNextFirebaseWorkout(session.user.uid)
      : Promise.resolve(null)
    )
      .then((next) => {
        if (next) setWorkout(next);
        else
          setWorkout({
            id: "empty",
            title: "Aucune séance planifiée",
            subtitle: "Importez une séance pour commencer",
            duration: 0,
            exercises: [],
            status: "planned",
            day: "",
          });
      })
      .catch(() => notify("Impossible de charger votre programme."))
      .finally(() => setActiveRestoreReady(true));
  }, [session, role]);

  useEffect(() => {
    if (!active || workoutPaused) return;
    const timer = window.setInterval(
      () => setWorkoutElapsedSeconds((value) => value + 1),
      1000,
    );
    return () => window.clearInterval(timer);
  }, [active, workoutPaused]);

  useEffect(() => {
    if (!session || !activeRestoreReady || role === "coach") return;
    const storageKey = `repflow-active-workout:${session.user.uid}`;
    if (!active) {
      window.localStorage.removeItem(storageKey);
      return;
    }
    window.localStorage.setItem(
      storageKey,
      JSON.stringify({
        workout,
        paused: workoutPaused,
        elapsedSeconds: workoutElapsedSeconds,
        savedAt: Date.now(),
      }),
    );
  }, [session, role, activeRestoreReady, active, workout, workoutPaused, workoutElapsedSeconds]);

  useEffect(() => {
    const token = new URLSearchParams(window.location.search).get("invite");
    if (!session || !token) return;
    const accept = async () => {
      try {
        await acceptCoachInvite(token);
      } catch (error) {
        notify(error instanceof Error ? error.message : "Invitation invalide ou expirée.");
        return;
      }
      setRole("client");
      setScreen("home");
      window.history.replaceState({}, "", window.location.pathname);
      notify("Coach connecté avec succès");
    };
    void accept();
  }, [session]);

  if (!authReady)
    return (
      <div className="loading-screen">
        <Brand />
        <span />
      </div>
    );
  if (!session && !demoMode)
    return <AuthScreen onDemo={() => setDemoMode(true)} />;

  if (!role)
    return (
      <Onboarding
        onSelect={(r) => {
          void chooseRole(r);
        }}
      />
    );

  const finish = async (durationSeconds = 0) => {
    if (session && !demoMode) {
      try {
        await saveFirebaseWorkout(
          session.user.uid,
          workout,
          effort,
          durationSeconds,
        );
      } catch (error) {
        notify(
          error instanceof Error ? error.message : "Échec de l’enregistrement.",
        );
        return;
      }
    }
    setActive(false);
    setWorkoutPaused(false);
    setWorkoutElapsedSeconds(0);
    setEffort(null);
    notify("Séance enregistrée — beau travail !");
  };
  const goBack = () => {
    if (screen === "workout") setScreen("sessions");
    else if (screen === "client-detail") setScreen("clients");
    else if (screen === "program-detail") setScreen("programs");
    else setScreen("home");
  };
  const navigateMobile = (next: Screen) => {
    setScreen(next);
    setMobileMenuOpen(false);
  };
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Brand />
        <nav>
          {role === "coach" ? (
            <>
              <Nav
                active={screen === "home"}
                icon={<Home />}
                label="Vue d’ensemble"
                onClick={() => setScreen("home")}
              />
              <Nav
                active={screen === "clients"}
                icon={<UsersRound />}
                label="Clients"
                onClick={() => setScreen("clients")}
              />
              <Nav
                active={screen === "programs"}
                icon={<CalendarDays />}
                label="Programmes"
                onClick={() => setScreen("programs")}
              />
              <Nav
                active={screen === "progress"}
                icon={<BarChart3 />}
                label="Analyses"
                onClick={() => setScreen("progress")}
              />
              <Nav
                active={screen === "tools"}
                icon={<TimerReset />}
                label="Outils"
                onClick={() => setScreen("tools")}
              />
              <Nav
                active={screen === "guide"}
                icon={<BookOpen />}
                label="Guide"
                onClick={() => setScreen("guide")}
              />
              <Nav
                active={screen === "profile"}
                icon={<UserRound />}
                label="Profil"
                onClick={() => setScreen("profile")}
              />
            </>
          ) : (
            <>
              <Nav
                active={screen === "home"}
                icon={<Home />}
                label="Accueil"
                onClick={() => setScreen("home")}
              />
              <Nav
                active={screen === "sessions" || screen === "workout"}
                icon={<Dumbbell />}
                label="Séances"
                onClick={() => setScreen("sessions")}
              />
              <Nav
                active={screen === "progress"}
                icon={<BarChart3 />}
                label="Progression"
                onClick={() => setScreen("progress")}
              />
              <Nav
                active={screen === "tools"}
                icon={<TimerReset />}
                label="Outils"
                onClick={() => setScreen("tools")}
              />
              <Nav
                active={screen === "guide"}
                icon={<BookOpen />}
                label="Guide"
                onClick={() => setScreen("guide")}
              />
              <Nav
                active={screen === "profile"}
                icon={<UserRound />}
                label="Profil"
                onClick={() => setScreen("profile")}
              />
            </>
          )}
        </nav>
        <button
          className="sidebar-bottom"
          onClick={() => setScreen("profile")}
          title="Ouvrir le profil"
        >
          <span className="avatar">{initials}</span>
          <div>
            <b>{displayName}</b>
            <small>{role === "coach" ? "Coach" : "Membre"}</small>
          </div>
          <MoreHorizontal />
        </button>
      </aside>
      <main>
        <header className="topbar">
          <button className="mobile-menu-button" type="button" onClick={() => setMobileMenuOpen(true)} aria-label="Ouvrir le menu">
            <Menu size={21} />
          </button>
          <Brand mobile />
          <div className="top-actions">
            {demoMode && <span className="demo-pill">Mode démonstration</span>}
            <button
              className="icon-button"
              disabled
              title="Notifications à venir"
            >
              <Bell size={19} />
            </button>
            <button
              className="avatar small"
              onClick={() => setScreen("profile")}
              title="Ouvrir le profil"
            >
              {initials}
            </button>
          </div>
        </header>
        {mobileMenuOpen && (
          <>
            <button className="mobile-menu-backdrop" type="button" aria-label="Fermer le menu" onClick={() => setMobileMenuOpen(false)} />
            <aside className="mobile-drawer" aria-label="Menu de navigation">
              <div className="mobile-drawer-head"><Brand /><button type="button" onClick={() => setMobileMenuOpen(false)} aria-label="Fermer"><X size={21} /></button></div>
              <nav>
                <button className={screen === "home" ? "active" : ""} onClick={() => navigateMobile("home")}><Home size={19} />Accueil</button>
                {role === "coach" ? <>
                  <button className={screen === "clients" ? "active" : ""} onClick={() => navigateMobile("clients")}><UsersRound size={19} />Clients</button>
                  <button className={screen === "programs" ? "active" : ""} onClick={() => navigateMobile("programs")}><CalendarDays size={19} />Programmes</button>
                </> : <button className={screen === "sessions" || screen === "workout" ? "active" : ""} onClick={() => navigateMobile("sessions")}><Dumbbell size={19} />Séances</button>}
                <button className={screen === "progress" ? "active" : ""} onClick={() => navigateMobile("progress")}><BarChart3 size={19} />Progression</button>
                <button className={screen === "tools" ? "active" : ""} onClick={() => navigateMobile("tools")}><TimerReset size={19} />Outils</button>
                <button className={screen === "guide" ? "active" : ""} onClick={() => navigateMobile("guide")}><BookOpen size={19} />Guide</button>
                <button className={screen === "profile" ? "active" : ""} onClick={() => navigateMobile("profile")}><UserRound size={19} />Profil</button>
              </nav>
            </aside>
          </>
        )}
        {screen !== "home" && (
          <button className="page-back-button" onClick={goBack}>
            <ArrowLeft size={17} /> Retour
          </button>
        )}
        {screen === "tools" ? (
          <WorkoutTools initial={toolPreset} />
        ) : screen === "guide" ? (
          <MovementGuide />
        ) : role === "coach" ? (
          screen === "profile" ? (
            <Profile
              role={role}
              displayName={displayName}
              email={session?.user.email ?? ""}
              demoMode={demoMode}
              onRole={() => setRole(null)}
              onSignOut={() => void signOut()}
            />
          ) : (
            <Coach
              screen={screen}
              setScreen={setScreen}
              notify={notify}
              displayName={displayName}
              onImport={() => setImportOpen(true)}
              selectedClientId={selectedClientId}
              onSelectClient={(id) => {
                setSelectedClientId(id);
                setScreen("client-detail");
              }}
              selectedProgramId={selectedProgramId}
              onSelectProgram={(id) => {
                setSelectedProgramId(id);
                setScreen("program-detail");
              }}
            />
          )
        ) : screen === "home" ? (
          <MemberHome
            role={role}
            displayName={displayName}
            workout={workout}
            start={() => {
              setScreen("workout");
              setWorkoutPaused(false);
              if (!active) setWorkoutElapsedSeconds(0);
              setActive(true);
            }}
            setScreen={setScreen}
            onImport={() => setImportOpen(true)}
          />
        ) : screen === "sessions" ? (
          <SessionsPage
            onOpen={(next) => {
              const isCurrentWorkout = active && next.id === workout.id;
              if (!isCurrentWorkout) {
                setWorkout(next);
                setActive(false);
                setWorkoutPaused(false);
                setWorkoutElapsedSeconds(0);
              }
              setScreen("workout");
            }}
            onImport={() => setImportOpen(true)}
            notify={notify}
            activeWorkoutId={active ? workout.id : null}
          />
        ) : screen === "workout" ? (
          <WorkoutScreen
            workout={workout}
            setWorkout={setWorkout}
            active={active}
            setActive={setActive}
            paused={workoutPaused}
            setPaused={setWorkoutPaused}
            elapsedSeconds={workoutElapsedSeconds}
            completed={completed}
            total={total}
            effort={effort}
            setEffort={setEffort}
            finish={finish}
            onLaunchBlock={(exercise) => {
              if (!exercise.blockType) return;
              setToolPreset({
                mode: exercise.blockType,
                work: exercise.workSeconds ?? exercise.blockDuration ?? 60,
                rest: exercise.blockRest ?? 0,
                rounds: exercise.blockRounds ?? 1,
              });
              setScreen("tools");
            }}
          />
        ) : screen === "progress" ? (
          <Progress />
        ) : (
          <Profile
            role={role}
            displayName={displayName}
            email={session?.user.email ?? ""}
            demoMode={demoMode}
            onRole={() => setRole(null)}
            onSignOut={() => void signOut()}
          />
        )}
      </main>
      {toast && (
        <div className="toast">
          <Check size={18} />
          {toast}
        </div>
      )}
      {importOpen && (
        <ImportWorkout
          onClose={() => setImportOpen(false)}
          onSaved={(next) => {
            setWorkout(next);
            setActive(false);
            setWorkoutPaused(false);
            setWorkoutElapsedSeconds(0);
            setScreen(role === "coach" ? "programs" : "workout");
            setImportOpen(false);
            notify("Séance importée dans votre programme");
          }}
        />
      )}
      {session && new URLSearchParams(window.location.search).get("share") && (
        <SharedWorkoutInvite
          userId={session.user.uid}
          onAccepted={(next) => {
            setWorkout(next);
            setActive(false);
            setScreen("sessions");
            notify("Séance ajoutée à votre compte");
          }}
        />
      )}
    </div>
  );
}

function SharedWorkoutInvite({ userId, onAccepted }: { userId: string; onAccepted: (workout: Workout) => void }) {
  const token = new URLSearchParams(window.location.search).get("share") ?? "";
  const [shared, setShared] = useState<Workout | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(true);
  useEffect(() => {
    if (!token) return;
    loadWorkoutShare(token).then(setShared).catch((reason) => setError(reason instanceof Error ? reason.message : "Partage indisponible."));
  }, [token]);
  const close = () => {
    setOpen(false);
    const url = new URL(window.location.href);
    url.searchParams.delete("share");
    window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
  };
  const accept = async () => {
    setBusy(true);
    try {
      const next = await acceptWorkoutShare(userId, token);
      close();
      onAccepted(next);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Ajout impossible.");
    } finally {
      setBusy(false);
    }
  };
  return <Dialog.Root open={open} onOpenChange={(nextOpen) => !nextOpen && close()}><Dialog.Portal><Dialog.Overlay className="modal-backdrop"/><Dialog.Content className="confirm-dialog shared-workout-dialog"><Dialog.Title>Séance partagée avec vous</Dialog.Title>{error ? <div className="data-error"><CircleAlert />{error}</div> : shared ? <><div className="shared-workout-preview"><Dumbbell/><div><h3>{shared.title}</h3><p>{shared.exercises.length} exercices · environ {shared.duration} min</p></div></div><ol>{shared.exercises.slice(0, 6).map((exercise) => <li key={exercise.id}><b>{exercise.name}</b><span>{exercise.sets} × {exercise.reps}</span></li>)}</ol>{shared.exercises.length > 6 && <p>+ {shared.exercises.length - 6} autres exercices</p>}</> : <p>Chargement de la séance…</p>}<div className="modal-actions"><Dialog.Close asChild><button className="secondary">Refuser</button></Dialog.Close><button className="primary" disabled={!shared || busy || Boolean(error)} onClick={() => void accept()}>{busy ? "Ajout…" : "Ajouter à mes séances"}</button></div></Dialog.Content></Dialog.Portal></Dialog.Root>;
}

function Brand({ mobile = false }: { mobile?: boolean }) {
  return (
    <div className={"brand " + (mobile ? "mobile" : "")}>
      <span>
        <Dumbbell size={20} />
      </span>
      <b>Repflow</b>
    </div>
  );
}
function Nav({
  active,
  icon,
  label,
  onClick,
}: {
  active: boolean;
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button className={active ? "nav-active" : ""} onClick={onClick}>
      {icon}
      <span>{label}</span>
    </button>
  );
}

function AuthScreen({ onDemo }: { onDemo: () => void }) {
  const [signup, setSignup] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<Role>("solo");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      const {
        createUserWithEmailAndPassword,
        signInWithEmailAndPassword,
        updateProfile,
      } = await import("firebase/auth");
      const credential = signup
        ? await createUserWithEmailAndPassword(firebaseAuth, email, password)
        : await signInWithEmailAndPassword(firebaseAuth, email, password);
      if (signup) {
        await updateProfile(credential.user, { displayName: name });
        await setDoc(doc(firestore, "profiles", credential.user.uid), {
          display_name: name,
          role,
          email,
          created_at: serverTimestamp(),
        });
      }
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Authentification impossible.",
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="auth-layout">
      <section className="auth-story">
        <Brand />
        <div>
          <span className="eyebrow">ENTRAÎNEZ-VOUS, SIMPLEMENT</span>
          <h1>
            Moins de gestion.
            <br />
            <em>Plus de progression.</em>
          </h1>
          <p>
            Vos programmes, vos performances et votre coach réunis dans une
            expérience sans friction.
          </p>
        </div>
        <small>Repflow · Votre entraînement, bien guidé.</small>
      </section>
      <section className="auth-panel">
        <form onSubmit={submit}>
          <span className="eyebrow">
            {signup ? "CRÉER VOTRE ESPACE" : "HEUREUX DE VOUS REVOIR"}
          </span>
          <h2>{signup ? "Commencer avec Repflow" : "Connexion"}</h2>
          <p>
            {signup
              ? "Quelques secondes suffisent pour commencer."
              : "Retrouvez votre prochaine séance."}
          </p>
          {signup && (
            <>
              <label>
                Nom complet
                <input
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Alex Martin"
                />
              </label>
              <label>
                Je souhaite
                <select
                  value={role}
                  onChange={(e) => setRole(e.target.value as Role)}
                >
                  <option value="solo">M’entraîner seul</option>
                  <option value="client">Rejoindre mon coach</option>
                  <option value="coach">Accompagner mes clients</option>
                </select>
              </label>
            </>
          )}
          <label>
            Adresse e-mail
            <input
              required
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="vous@exemple.fr"
            />
          </label>
          <label>
            Mot de passe
            <input
              required
              minLength={6}
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="6 caractères minimum"
            />
          </label>
          {message && <div className="auth-message">{message}</div>}
          <button disabled={busy} className="primary wide" type="submit">
            {busy
              ? "Veuillez patienter…"
              : signup
                ? "Créer mon compte"
                : "Se connecter"}
          </button>
          <button
            className="auth-switch"
            type="button"
            onClick={() => {
              setSignup(!signup);
              setMessage("");
            }}
          >
            {signup
              ? "Déjà membre ? Se connecter"
              : "Pas encore de compte ? S’inscrire"}
          </button>
          <button className="demo-link" type="button" onClick={onDemo}>
            Continuer avec la démonstration
          </button>
        </form>
      </section>
    </div>
  );
}

function Onboarding({ onSelect }: { onSelect: (r: Role) => void }) {
  return (
    <div className="onboarding">
      <div className="onboard-card">
        <Brand />
        <div className="eyebrow">BIENVENUE SUR REPFLOW</div>
        <h1>
          Votre entraînement.
          <br />
          <em>Sans friction.</em>
        </h1>
        <p>
          Une expérience claire pour avancer seul ou avec un coach, sans passer
          votre séance à gérer une application.
        </p>
        <h3>Comment souhaitez-vous commencer ?</h3>
        <div className="role-grid">
          <RoleCard
            icon={<Dumbbell />}
            title="Je m’entraîne seul"
            text="Créez ou importez votre programme et suivez vos progrès."
            onClick={() => onSelect("solo")}
          />
          <RoleCard
            icon={<UserRound />}
            title="J’ai un coach"
            text="Rejoignez votre coach avec son code d’invitation."
            onClick={() => onSelect("client")}
          />
          <RoleCard
            icon={<UsersRound />}
            title="Je suis coach"
            text="Programmez, suivez et accompagnez vos clients."
            onClick={() => onSelect("coach")}
          />
        </div>
        <small className="legal">
          En continuant, vous acceptez les conditions d’utilisation et la
          politique de confidentialité.
        </small>
      </div>
    </div>
  );
}
function RoleCard({
  icon,
  title,
  text,
  onClick,
}: {
  icon: React.ReactNode;
  title: string;
  text: string;
  onClick: () => void;
}) {
  return (
    <button className="role-card" onClick={onClick}>
      <span className="role-icon">{icon}</span>
      <div>
        <b>{title}</b>
        <p>{text}</p>
      </div>
      <ChevronRight />
    </button>
  );
}

function MemberHome({
  role,
  displayName,
  workout,
  start,
  setScreen,
  onImport,
}: {
  role: Role;
  displayName: string;
  workout: Workout;
  start: () => void;
  setScreen: (s: Screen) => void;
  onImport: () => void;
}) {
  type HomeLog = {
    completed_at: string | null;
    duration_seconds: number;
    workouts: { title: string } | null;
    set_logs: { load: number | null; reps: number | null }[];
  };
  const [recentLogs, setRecentLogs] = useState<HomeLog[]>([]);
  useEffect(() => {
    const uid = firebaseAuth.currentUser?.uid;
    if (!uid) return;
    loadRecentLogs(uid).then((data) => setRecentLogs(data as HomeLog[])).catch(() => setRecentLogs([]));
  }, []);
  const today = new Intl.DateTimeFormat("fr-FR", {
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(new Date());
  const weekStart = new Date();
  weekStart.setDate(weekStart.getDate() - ((weekStart.getDay() + 6) % 7));
  weekStart.setHours(0, 0, 0, 0);
  const weeklyLogs = recentLogs.filter(
    (log) => log.completed_at && new Date(log.completed_at) >= weekStart,
  );
  const activeDays = new Set(
    weeklyLogs.map((log) => new Date(log.completed_at!).getDay()),
  );
  const latest = recentLogs[0];
  const latestBest = Math.max(
    0,
    ...(latest?.set_logs ?? []).map((set) => set.load ?? 0),
  );
  return (
    <div className="page">
      <div className="welcome">
        <div>
          <span className="eyebrow">{today.toUpperCase()}</span>
          <h1>
            Bonjour {displayName.split(" ")[0]} <span>👋</span>
          </h1>
          <p>
            {role === "client"
              ? "Votre coach a préparé la suite. Il ne reste qu’à commencer."
              : "Prêt pour une nouvelle séance ?"}
          </p>
        </div>
        <div className="welcome-actions">
          {role === "solo" && (
            <button className="secondary" onClick={onImport}>
              <Sparkles />
              Importer une séance
            </button>
          )}
          <div className="streak">
            <Flame />
            <div>
              <b>
                {weeklyLogs.length} séance{weeklyLogs.length > 1 ? "s" : ""}
              </b>
              <small>
                terminée{weeklyLogs.length > 1 ? "s" : ""} cette semaine
              </small>
            </div>
          </div>
        </div>
      </div>
      <section className="next-card">
        <div className="next-copy">
          <div className="card-label">
            <span>PROCHAINE SÉANCE</span>
            <i>Aujourd’hui</i>
          </div>
          <h2>{workout.title}</h2>
          <p>
            {workout.subtitle} · {workout.exercises.length} exercices
          </p>
          <div className="meta">
            <span>
              <Clock3 />
              {workout.duration} min
            </span>
            <span>
              <Activity />
              {workout.exercises.reduce(
                (sum, exercise) => sum + exercise.sets,
                0,
              )}{" "}
              séries
            </span>
          </div>
          <button className="primary" onClick={start}>
            <Play fill="currentColor" />
            Commencer la séance
          </button>
          <button className="text-button" onClick={() => setScreen("workout")}>
            Voir le détail
          </button>
        </div>
        <div className="next-art">
          <div className="plate plate-one" />
          <div className="plate plate-two" />
          <Dumbbell />
        </div>
      </section>
      <div className="two-col">
        <section>
          <div className="section-title">
            <div>
              <span className="eyebrow">CETTE SEMAINE</span>
              <h2>Votre rythme</h2>
            </div>
            <button
              className="text-button"
              onClick={() => setScreen("progress")}
            >
              Voir tout
            </button>
          </div>
          <div className="weekly">
            <div className="ring">
              <span>{weeklyLogs.length}</span>
            </div>
            <div>
              <b>
                {weeklyLogs.length
                  ? "Activité enregistrée"
                  : "Aucune séance cette semaine"}
              </b>
              <p>
                Ces données proviennent de vos séances réellement terminées.
              </p>
              <div className="days">
                {["L", "M", "M", "J", "V", "S", "D"].map((d, i) => (
                  <span
                    className={
                      activeDays.has(i === 6 ? 0 : i + 1)
                        ? "done"
                        : new Date().getDay() === (i === 6 ? 0 : i + 1)
                          ? "today"
                          : ""
                    }
                    key={i}
                  >
                    {activeDays.has(i === 6 ? 0 : i + 1) ? <Check /> : d}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </section>
        <section>
          <div className="section-title">
            <div>
              <span className="eyebrow">DERNIÈRE ACTIVITÉ</span>
              <h2>Progression</h2>
            </div>
          </div>
          <div className="progress-card">
            <div className="mini-icon">
              <BarChart3 />
            </div>
            <div>
              <small>{latest?.workouts?.title ?? "Aucune activité"}</small>
              <b>
                {latest
                  ? `${latest.set_logs?.length ?? 0} séries enregistrées`
                  : "Terminez une séance"}
              </b>
              <span>
                {latestBest
                  ? `Charge maximale : ${latestBest} kg`
                  : "Vos résultats apparaîtront ici"}
              </span>
            </div>
            <Sparkles />
          </div>
        </section>
      </div>
    </div>
  );
}

function ImportWorkout({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: (workout: Workout) => void;
}) {
  const [text, setText] = useState(
    "Séance Push\nDéveloppé couché 4×8 — repos 2 min\nDéveloppé incliné haltères 3×10\nÉlévations latérales 4×15 — repos 60s\nExtension triceps 3×12",
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [fileName, setFileName] = useState("");
  const [fileStatus, setFileStatus] = useState("");
  const [processingFile, setProcessingFile] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiParsed, setAiParsed] = useState<AiWorkoutImport | null>(null);
  const [editedParsed, setEditedParsed] = useState<AiWorkoutImport | null>(null);
  const [editingExercise, setEditingExercise] = useState<number | null>(null);
  const [catalog, setCatalog] = useState<CatalogExercise[]>([]);
  const localParsed = useMemo(() => parseWorkoutText(text), [text]);
  const parsed = editedParsed ?? aiParsed ?? localParsed;
  const updateImportedExercise = (
    index: number,
    changes: Partial<AiWorkoutImport["exercises"][number]>,
  ) => {
    setEditedParsed((current) => {
      const source = current ?? {
        ...(aiParsed ?? localParsed),
        exercises: [...(aiParsed ?? localParsed).exercises],
      };
      return {
        ...source,
        exercises: source.exercises.map((exercise, exerciseIndex) =>
          exerciseIndex === index ? { ...exercise, ...changes } : exercise,
        ),
      };
    });
  };
  const removeImportedExercise = (index: number) => {
    setEditedParsed((current) => {
      const source = current ?? {
        ...(aiParsed ?? localParsed),
        exercises: [...(aiParsed ?? localParsed).exercises],
      };
      return {
        ...source,
        exercises: source.exercises.filter((_, exerciseIndex) => exerciseIndex !== index),
      };
    });
    setEditingExercise(null);
  };
  const setImportedBlockType = (
    index: number,
    blockType: AiWorkoutImport["exercises"][number]["blockType"],
  ) => {
    const defaults = blockType === "EMOM"
      ? { workSeconds: 60, blockRest: 0, blockRounds: 10, blockDuration: 600 }
      : blockType === "AMRAP"
        ? { workSeconds: null, blockRest: 0, blockRounds: 1, blockDuration: 600 }
        : blockType === "Tabata"
          ? { workSeconds: 20, blockRest: 10, blockRounds: 8, blockDuration: 240 }
          : blockType === "Intervalles"
            ? { workSeconds: 30, blockRest: 30, blockRounds: 10, blockDuration: 600 }
            : blockType === "Circuit"
              ? { workSeconds: 45, blockRest: 15, blockRounds: 4, blockDuration: 240 }
              : { workSeconds: null, blockRest: null, blockRounds: null, blockDuration: null };
    updateImportedExercise(index, {
      blockType,
      blockKey: blockType ? `bloc-${index + 1}` : null,
      ...defaults,
    });
  };
  useEffect(() => {
    fetch("/data/exercises.json")
      .then((r) => r.json())
      .then(setCatalog)
      .catch(() => setCatalog([]));
  }, []);
  const readFile = async (file?: File) => {
    if (!file) return;
    setError("");
    setFileName(file.name);
    setProcessingFile(true);
    try {
      const extracted = await extractWorkoutText(file, setFileStatus);
      if (!extracted.trim())
        throw new Error("Aucun texte détecté dans ce fichier.");
      setText(extracted);
      setAiParsed(null);
      setEditedParsed(null);
      setEditingExercise(null);
      setFileStatus("Fichier analysé — vérifiez le résultat ci-dessous.");
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Impossible d’analyser le fichier.",
      );
      setFileStatus("");
    } finally {
      setProcessingFile(false);
    }
  };
  const analyzeWithAi = async () => {
    if (!text.trim()) return;
    setAiBusy(true);
    setError("");
    try {
      const user = firebaseAuth.currentUser;
      const examples = user
        ? await loadSimilarImportCorrections(user.uid, text)
        : [];
      const result = await analyzeWorkoutWithAi(text, examples);
      setAiParsed(result);
      setEditedParsed(null);
      setEditingExercise(null);
      setFileStatus("Séance structurée par l’IA — vérifiez avant d’ajouter.");
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Analyse IA impossible.",
      );
    } finally {
      setAiBusy(false);
    }
  };
  const save = async () => {
    if (!parsed.exercises.length) {
      setError(
        "Aucun exercice reconnu. Utilisez par exemple : Squat 4×8 — repos 2 min",
      );
      return;
    }
    setBusy(true);
    setError("");
    const user = firebaseAuth.currentUser;
    if (!user) {
      setBusy(false);
      setError("Connectez-vous pour enregistrer cette séance.");
      return;
    }
    try {
      const batch = writeBatch(firestore);
      const program = doc(collection(firestore, "programs"));
      batch.set(program, {
        owner_id: user.uid,
        title: parsed.title,
        description: "Importé depuis le programme de mon coach",
        duration_weeks: 1,
        client_ids: {},
        created_at: serverTimestamp(),
      });
      const workoutExercises = parsed.exercises.map((item, position) => {
        const catalogMatch = findCatalogExercise(catalog, item.name);
        return stripUndefined({
          id: crypto.randomUUID(),
          name: item.name,
          position,
          sets: item.sets,
          reps: item.reps,
          rest: item.rest,
          muscle: catalogMatch?.primaryMuscles?.[0] ?? "Non renseigné",
          done: 0,
          load: item.load ?? undefined,
          notes: item.notes,
          method: item.method,
          blockKey: item.blockKey ?? undefined,
          blockType: item.blockType ?? undefined,
          blockDuration: item.blockDuration ?? undefined,
          workSeconds: item.workSeconds ?? undefined,
          blockRest: item.blockRest ?? undefined,
          blockRounds: item.blockRounds ?? undefined,
          imageUrl: catalogMatch?.images?.[0]
            ? catalogImage(catalogMatch.images[0])
            : undefined,
          sourceUrl: catalogMatch ? catalogSource(catalogMatch.id) : undefined,
        });
      });
      const workout = doc(collection(firestore, "workouts"));
      batch.set(workout, {
        owner_id: user.uid,
        program_id: program.id,
        client_ids: {},
        title: parsed.title,
        position: 1,
        estimated_minutes: 45,
        exercises: workoutExercises,
        warmup: buildWarmupItems(
          parsed.exercises.map((item) => item.name).join(" "),
        ).map(([name, detail], position) => ({ name, detail, position })),
        created_at: serverTimestamp(),
      });
      if (aiParsed && editedParsed && importWasCorrected(aiParsed, editedParsed)) {
        const correction = doc(collection(firestore, "import_corrections"));
        batch.set(correction, {
          user_id: user.uid,
          sourceText: text.slice(0, 12000),
          before: JSON.parse(JSON.stringify(aiParsed)),
          after: JSON.parse(JSON.stringify(editedParsed)),
          created_at: serverTimestamp(),
        });
      }
      await batch.commit();
      setBusy(false);
      onSaved({
        id: workout.id,
        title: parsed.title,
        subtitle: "Programme importé",
        duration: 45,
        exercises: workoutExercises,
        status: "planned",
        day: "À faire",
      });
      return;
    } catch (error) {
      setBusy(false);
      setError(
        error instanceof Error
          ? error.message
          : "Impossible de créer le programme Firebase.",
      );
      return;
    }
  };
  return (
    <Dialog.Root open onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="modal-backdrop" />
        <Dialog.Content
          className="import-modal"
          aria-describedby="import-description"
        >
          <div className="modal-head">
            <div>
              <span className="eyebrow">PROGRAMME EXTERNE</span>
              <Dialog.Title>Importer la séance de votre coach</Dialog.Title>
            </div>
            <Dialog.Close asChild>
              <button aria-label="Fermer">
                <X />
              </button>
            </Dialog.Close>
          </div>
          <Dialog.Description className="modal-intro" id="import-description">
            Importez le PDF ou la photo reçue de votre coach, ou collez
            directement son message.
          </Dialog.Description>
          <label
            className={"file-drop " + (processingFile ? "processing" : "")}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              void readFile(event.dataTransfer.files[0]);
            }}
          >
            <input
              type="file"
              accept="application/pdf,image/jpeg,image/png,image/webp,text/plain,text/csv,.pdf,.jpg,.jpeg,.png,.webp,.txt,.csv"
              disabled={processingFile}
              onChange={(event) => void readFile(event.target.files?.[0])}
            />
            <span className="file-icon">
              <Upload />
            </span>
            <div>
              <b>{fileName || "Déposez le programme ici"}</b>
              <p>
                {fileStatus ||
                  "PDF, JPEG, PNG, TXT ou CSV · cliquez pour parcourir"}
              </p>
            </div>
            <span className="file-action">
              {processingFile ? "Analyse…" : "Choisir"}
            </span>
          </label>
          <div className="import-separator">
            <span>ou collez le texte</span>
          </div>
          <label>
            Texte de la séance
            <textarea
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                setAiParsed(null);
                setEditedParsed(null);
                setEditingExercise(null);
              }}
              rows={8}
            />
          </label>
          <button
            className="ai-analyze"
            disabled={aiBusy || processingFile || !text.trim()}
            onClick={() => void analyzeWithAi()}
          >
            <Sparkles />
            {aiBusy ? "L’IA structure la séance…" : "Analyser avec l’IA"}
          </button>
          {aiParsed && (
            <p className="ai-success">
              <Check /> Analyse IA terminée : {aiParsed.exercises.length}{" "}
              exercices reconnus.
            </p>
          )}
          <div className="parse-summary">
            <div>
              <b>{parsed.title}</b>
              <span>{catalog.length} démonstrations disponibles</span>
            </div>
            {parsed.exercises.map((e, index) => {
              const match = findCatalogExercise(catalog, e.name);
              return (
                <div className="parsed-row" key={`${e.name}-${index}`}>
                  {match?.images?.[0] ? (
                    <img src={catalogImage(match.images[0])} alt="" />
                  ) : (
                    <span>
                      <Check />
                    </span>
                  )}
                  <b>{e.name}</b>
                  {e.method && <em>{e.method}</em>}
                  <small>
                    {e.load && e.sets === 1
                      ? `${e.reps} × ${e.load}`
                      : `${e.sets} × ${e.reps}${e.load ? ` · ${e.load}` : ""}`}
                  </small>
                  <small>
                    {e.rest > 0 ? `Récupération : ${e.rest}s` : "Récupération : —"}
                  </small>
                  {e.notes && (
                    <p className="parsed-instructions">
                      <b>Consignes :</b> {e.notes}
                    </p>
                  )}
                  <div className="parsed-actions">
                    <button
                      type="button"
                      className="text-button"
                      onClick={() => setEditingExercise(editingExercise === index ? null : index)}
                    >
                      <Pencil /> {editingExercise === index ? "Fermer" : "Modifier"}
                    </button>
                    <button
                      type="button"
                      className="text-button danger-text"
                      onClick={() => removeImportedExercise(index)}
                    >
                      <Trash2 /> Supprimer
                    </button>
                  </div>
                  {editingExercise === index && (
                    <div className="parsed-editor">
                      <label>Exercice<input value={e.name} onChange={(event) => updateImportedExercise(index, { name: event.target.value })} /></label>
                      <label>Méthode<input value={e.method ?? ""} onChange={(event) => updateImportedExercise(index, { method: event.target.value || undefined })} /></label>
                      <label>Format de travail<select value={e.blockType ?? ""} onChange={(event) => setImportedBlockType(index, (event.target.value || null) as AiWorkoutImport["exercises"][number]["blockType"])}><option value="">Séries classiques</option><option value="EMOM">EMOM</option><option value="AMRAP">AMRAP</option><option value="Tabata">Tabata</option><option value="Intervalles">Intervalles</option><option value="Circuit">Circuit</option></select></label>
                      <label>Séries<input type="number" min="1" value={e.sets} onChange={(event) => updateImportedExercise(index, { sets: Math.max(1, Number(event.target.value) || 1) })} /></label>
                      <label>Répétitions<input value={e.reps} onChange={(event) => updateImportedExercise(index, { reps: event.target.value })} /></label>
                      <label>Charge<input value={e.load ?? ""} placeholder="ex. 115 kg ou PDC" onChange={(event) => updateImportedExercise(index, { load: event.target.value || null })} /></label>
                      <label>Récupération (secondes)<input type="number" min="0" value={e.rest} onChange={(event) => updateImportedExercise(index, { rest: Math.max(0, Number(event.target.value) || 0) })} /></label>
                      {e.blockType && <><label>Durée totale (secondes)<input type="number" min="1" value={e.blockDuration ?? ""} onChange={(event) => updateImportedExercise(index, { blockDuration: Number(event.target.value) || null })} /></label><label>Travail (secondes)<input type="number" min="1" value={e.workSeconds ?? ""} disabled={e.blockType === "AMRAP"} onChange={(event) => updateImportedExercise(index, { workSeconds: Number(event.target.value) || null })} /></label><label>Repos du bloc (secondes)<input type="number" min="0" value={e.blockRest ?? 0} onChange={(event) => updateImportedExercise(index, { blockRest: Math.max(0, Number(event.target.value) || 0) })} /></label><label>Nombre de tours<input type="number" min="1" value={e.blockRounds ?? 1} onChange={(event) => updateImportedExercise(index, { blockRounds: Math.max(1, Number(event.target.value) || 1) })} /></label></>}
                      <label className="parsed-editor-wide">Consignes<textarea rows={2} value={e.notes ?? ""} onChange={(event) => updateImportedExercise(index, { notes: event.target.value || undefined })} /></label>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          {error && (
            <div className="data-error">
              <CircleAlert />
              {error}
            </div>
          )}
          <div className="modal-actions">
            <Dialog.Close asChild>
              <button className="secondary">Annuler</button>
            </Dialog.Close>
            <button
              className="primary"
              disabled={busy || !parsed.exercises.length}
              onClick={save}
            >
              {busy ? "Import en cours…" : "Ajouter à mes programmes"}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function SessionsPage({
  onOpen,
  onImport,
  notify,
  activeWorkoutId,
}: {
  onOpen: (workout: Workout) => void;
  onImport: () => void;
  notify: (message: string) => void;
  activeWorkoutId: string | null;
}) {
  const [items, setItems] = useState<WorkoutListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState("");
  const [pendingDelete, setPendingDelete] = useState<WorkoutListItem | null>(
    null,
  );
  const [editing, setEditing] = useState<WorkoutListItem | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editExercises, setEditExercises] = useState<
    Array<{ name: string; sets: number; reps: string; rest: number }>
  >([]);
  const [savingEdit, setSavingEdit] = useState(false);
  const [sharingId, setSharingId] = useState("");
  const [shareUrl, setShareUrl] = useState("");

  const shareWorkout = async (item: WorkoutListItem) => {
    const user = firebaseAuth.currentUser;
    if (!user) return;
    setSharingId(item.workout.id);
    try {
      const token = await createWorkoutShare(user.uid, item.workout);
      setShareUrl(`${window.location.origin}${window.location.pathname}?share=${token}`);
    } catch (error) {
      notify(error instanceof Error ? error.message : "Partage impossible.");
    } finally {
      setSharingId("");
    }
  };

  const refresh = async () => {
    const user = firebaseAuth.currentUser;
    if (!user) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      setItems(await loadFirebaseWorkouts(user.uid));
    } catch (error) {
      notify(error instanceof Error ? error.message : "Chargement impossible.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  const remove = async (item: WorkoutListItem) => {
    const user = firebaseAuth.currentUser;
    if (!user) return;
    setDeleting(item.programId);
    try {
      await deleteFirebaseWorkout(item.programId, item.workout.id);
    } catch (error) {
      notify(
        error instanceof Error ? error.message : "Suppression impossible.",
      );
      setDeleting("");
      return;
    }
    setDeleting("");
    setItems((current) =>
      current.filter((row) => row.programId !== item.programId),
    );
    setPendingDelete(null);
    notify("Séance supprimée");
  };

  const saveEdit = async () => {
    if (
      !editing ||
      !editTitle.trim() ||
      !editExercises.some((exercise) => exercise.name.trim())
    )
      return;
    setSavingEdit(true);
    try {
      const exercises = editExercises
        .filter((exercise) => exercise.name.trim())
        .map((exercise, position) => ({
          id: editing.workout.exercises[position]?.id ?? crypto.randomUUID(),
          name: exercise.name.trim(),
          position,
          sets: exercise.sets,
          reps: exercise.reps,
          rest: exercise.rest,
          muscle:
            editing.workout.exercises[position]?.muscle ?? "Non renseigné",
          done: 0,
        }));
      await updateFirebaseWorkout(editing.workout.id, editTitle, exercises);
      setItems((current) =>
        current.map((item) =>
          item.workout.id === editing.workout.id
            ? {
                ...item,
                workout: {
                  ...item.workout,
                  title: editTitle.trim(),
                  exercises,
                },
              }
            : item,
        ),
      );
      setEditing(null);
      notify("Séance modifiée");
    } catch (error) {
      notify(
        error instanceof Error ? error.message : "Modification impossible.",
      );
    } finally {
      setSavingEdit(false);
    }
  };

  return (
    <div className="page">
      <div className="page-actions">
        <PageTitle
          eyebrow="MES ENTRAÎNEMENTS"
          title="Mes séances"
          text="Choisissez une séance à commencer ou supprimez un ancien import."
        />
        <button className="primary" onClick={onImport}>
          <Plus /> Importer une séance
        </button>
      </div>
      {loading ? (
        <div
          className="session-list loading-list"
          aria-label="Chargement des séances"
        >
          {[1, 2, 3].map((item) => (
            <div className="skeleton-session" key={item}>
              <span />
              <div>
                <i />
                <i />
                <i />
              </div>
            </div>
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="data-empty">
          <Dumbbell />
          <h3>Aucune séance enregistrée</h3>
          <p>Importez le programme de votre coach pour commencer.</p>
          <button className="primary" onClick={onImport}>
            Importer une séance
          </button>
        </div>
      ) : (
        <div className="session-list">
          {items.map((item) => (
            <article className="session-list-card" key={item.workout.id}>
              <span className="program-icon">
                <Dumbbell />
              </span>
              <div>
                <small>
                  {new Intl.DateTimeFormat("fr-FR", {
                    dateStyle: "medium",
                  }).format(new Date(item.createdAt))}
                </small>
                <h3>{item.workout.title}</h3>
                <p>
                  {item.workout.exercises.length} exercices · environ{" "}
                  {item.workout.duration} min
                </p>
              </div>
              <button
                className={activeWorkoutId === item.workout.id ? "primary" : "secondary"}
                onClick={() => onOpen(item.workout)}
              >
                <Play /> {activeWorkoutId === item.workout.id ? "Continuer" : "Commencer"}
              </button>
              <button
                className="secondary"
                onClick={() => {
                  setEditing(item);
                  setEditTitle(item.workout.title);
                  setEditExercises(
                    item.workout.exercises.map((exercise) => ({
                      name: exercise.name,
                      sets: exercise.sets,
                      reps: exercise.reps,
                      rest: exercise.rest,
                    })),
                  );
                }}
              >
                Modifier
              </button>
              <button className="secondary share-session" disabled={sharingId === item.workout.id} onClick={() => void shareWorkout(item)}>
                <Share2 /> {sharingId === item.workout.id ? "Création…" : "Partager"}
              </button>
              <button
                className="delete-session"
                disabled={deleting === item.programId}
                onClick={() => setPendingDelete(item)}
                title="Supprimer la séance"
              >
                <Trash2 />
              </button>
            </article>
          ))}
        </div>
      )}
      <AlertDialog.Root
        open={Boolean(pendingDelete)}
        onOpenChange={(open) => !open && setPendingDelete(null)}
      >
        <AlertDialog.Portal>
          <AlertDialog.Overlay className="modal-backdrop" />
          <AlertDialog.Content className="confirm-dialog">
            <AlertDialog.Title>Supprimer cette séance ?</AlertDialog.Title>
            <AlertDialog.Description>
              « {pendingDelete?.workout.title} » sera définitivement supprimée
              avec toutes ses séries.
            </AlertDialog.Description>
            <div className="modal-actions">
              <AlertDialog.Cancel asChild>
                <button className="secondary">Annuler</button>
              </AlertDialog.Cancel>
              <AlertDialog.Action asChild>
                <button
                  className="danger-button"
                  disabled={
                    !pendingDelete || deleting === pendingDelete.programId
                  }
                  onClick={() => pendingDelete && void remove(pendingDelete)}
                >
                  {deleting ? "Suppression…" : "Supprimer"}
                </button>
              </AlertDialog.Action>
            </div>
          </AlertDialog.Content>
        </AlertDialog.Portal>
      </AlertDialog.Root>
      <Dialog.Root open={Boolean(shareUrl)} onOpenChange={(open) => !open && setShareUrl("")}>
        <Dialog.Portal>
          <Dialog.Overlay className="modal-backdrop" />
          <Dialog.Content className="confirm-dialog share-dialog">
            <Dialog.Title>Partager cette séance</Dialog.Title>
            <Dialog.Description>Envoyez ce lien à une personne qui possède Repflow. Elle pourra consulter la séance puis l’ajouter à son compte.</Dialog.Description>
            <label>Lien valable 30 jours<input value={shareUrl} readOnly onFocus={(event) => event.currentTarget.select()} /></label>
            <div className="modal-actions"><Dialog.Close asChild><button className="secondary">Fermer</button></Dialog.Close><button className="primary" onClick={() => void navigator.clipboard.writeText(shareUrl).then(() => notify("Lien copié"))}>Copier le lien</button></div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
      <Dialog.Root
        open={Boolean(editing)}
        onOpenChange={(open) => !open && setEditing(null)}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="modal-backdrop" />
          <Dialog.Content className="confirm-dialog">
            <Dialog.Title>Modifier la séance</Dialog.Title>
            <label>
              Nom de la séance
              <input
                value={editTitle}
                onChange={(event) => setEditTitle(event.target.value)}
                autoFocus
              />
            </label>
            <div className="edit-exercises">
              <div className="section-title">
                <h3>Exercices</h3>
                <button
                  className="secondary"
                  type="button"
                  onClick={() =>
                    setEditExercises((current) => [
                      ...current,
                      { name: "", sets: 3, reps: "10", rest: 90 },
                    ])
                  }
                >
                  + Ajouter
                </button>
              </div>
              {editExercises.map((exercise, index) => (
                <div
                  className="edit-exercise-row"
                  key={`${editing?.workout.id}-${index}`}
                >
                  <input
                    aria-label="Nom de l’exercice"
                    value={exercise.name}
                    placeholder="Nom de l’exercice"
                    onChange={(event) =>
                      setEditExercises((current) =>
                        current.map((item, itemIndex) =>
                          itemIndex === index
                            ? { ...item, name: event.target.value }
                            : item,
                        ),
                      )
                    }
                  />
                  <input
                    aria-label="Séries"
                    type="number"
                    min="1"
                    value={exercise.sets}
                    onChange={(event) =>
                      setEditExercises((current) =>
                        current.map((item, itemIndex) =>
                          itemIndex === index
                            ? { ...item, sets: Number(event.target.value) }
                            : item,
                        ),
                      )
                    }
                  />
                  <input
                    aria-label="Répétitions"
                    value={exercise.reps}
                    placeholder="Reps"
                    onChange={(event) =>
                      setEditExercises((current) =>
                        current.map((item, itemIndex) =>
                          itemIndex === index
                            ? { ...item, reps: event.target.value }
                            : item,
                        ),
                      )
                    }
                  />
                  <input
                    aria-label="Repos en secondes"
                    type="number"
                    min="0"
                    value={exercise.rest}
                    onChange={(event) =>
                      setEditExercises((current) =>
                        current.map((item, itemIndex) =>
                          itemIndex === index
                            ? { ...item, rest: Number(event.target.value) }
                            : item,
                        ),
                      )
                    }
                  />
                  <button
                    className="row-delete"
                    type="button"
                    title="Supprimer l’exercice"
                    onClick={() =>
                      setEditExercises((current) =>
                        current.filter((_, itemIndex) => itemIndex !== index),
                      )
                    }
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              ))}
            </div>
            <div className="modal-actions">
              <Dialog.Close asChild>
                <button className="secondary">Annuler</button>
              </Dialog.Close>
              <button
                className="primary"
                disabled={
                  !editTitle.trim() ||
                  !editExercises.some((exercise) => exercise.name.trim()) ||
                  savingEdit
                }
                onClick={() => void saveEdit()}
              >
                {savingEdit ? "Enregistrement…" : "Enregistrer"}
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}

function MovementGuide() {
  const [category, setCategory] = useState("Jambes");
  const [atlasMuscle, setAtlasMuscle] = useState<MuscleZone | null>(null);
  const [catalog, setCatalog] = useState<CatalogExercise[]>([]);
  const [search, setSearch] = useState("");
  const [catalogPage, setCatalogPage] = useState(1);
  const [selectedExercise, setSelectedExercise] =
    useState<CatalogExercise | null>(null);
  useEffect(() => {
    fetch("/data/exercises.json")
      .then((response) => response.json())
      .then(setCatalog)
      .catch(() => setCatalog([]));
  }, []);
  const items: Record<
    string,
    { title: string; description: string; image?: string }[]
  > = {
    Jambes: [
      {
        title: "Squat au poids du corps",
        description:
          "Pieds stables, genoux dans l’axe des pieds, descente contrôlée et remontée en poussant dans le sol.",
        image: "/images/guides/squat-guide.png",
      },
      {
        title: "Hack squat",
        description:
          "Dos maintenu contre le dossier, pieds stables et amplitude contrôlée.",
      },
    ],
    Dos: [
      {
        title: "Traction",
        description:
          "Engagez les omoplates puis tirez la poitrine vers la barre sans balancer.",
      },
      {
        title: "Rowing",
        description:
          "Gardez le dos neutre et ramenez les coudes vers l’arrière.",
      },
    ],
    Pectoraux: [
      {
        title: "Développé couché",
        description:
          "Omoplates serrées, pieds stables et trajectoire contrôlée.",
      },
    ],
    Épaules: [
      {
        title: "Élévations latérales",
        description:
          "Bras légèrement fléchis, mouvement contrôlé et épaules détendues.",
      },
    ],
    Bras: [
      {
        title: "Curl biceps",
        description: "Coudes proches du corps, sans élan, descente contrôlée.",
      },
    ],
    Abdominaux: [
      {
        title: "Gainage",
        description: "Corps aligné, bassin neutre et respiration régulière.",
      },
    ],
    Machines: [
      {
        title: "Réglage d’une machine",
        description:
          "Alignez l’axe de rotation de la machine avec l’articulation travaillée.",
      },
    ],
  };
  const catalogZones = (item: CatalogExercise) => {
    const mapping: Record<string, MuscleZone> = { chest: 'pectoraux', shoulders: 'épaules', biceps: 'biceps', triceps: 'triceps', forearms: 'avant-bras', abdominals: 'abdominaux', lats: 'dorsaux', 'middle back': 'dorsaux', traps: 'trapèzes', neck: 'trapèzes', 'lower back': 'lombaires', glutes: 'fessiers', quadriceps: 'quadriceps', hamstrings: 'ischio-jambiers', adductors: 'adducteurs', calves: 'mollets' };
    return [...item.primaryMuscles, ...item.secondaryMuscles].map(value => mapping[value]).filter(Boolean);
  };
  const atlasItems = (Object.keys(muscleZoneLabels) as MuscleZone[]).map(zone => ({ zone, primary: true, count: catalog.filter(item => catalogZones(item).includes(zone)).length }));
  const filtered = catalog.filter(item => item.name.toLowerCase().includes(search.toLowerCase()) && (!atlasMuscle || catalogZones(item).includes(atlasMuscle)));
  const pageSize = 20;
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const visible = filtered.slice(
    (catalogPage - 1) * pageSize,
    catalogPage * pageSize,
  );
  const changeSearch = (value: string) => {
    setSearch(value);
    setCatalogPage(1);
  };
  return (
    <div className="page tools-page">
      <PageTitle
        eyebrow="BIBLIOTHÈQUE"
        title="Guide des mouvements"
        text="Comprenez chaque exercice avant de le pratiquer."
      />
      <MuscleAtlas guide items={atlasItems} selected={atlasMuscle} onSelect={zone => { setAtlasMuscle(zone); setCatalogPage(1); }} />
      {atlasMuscle && <p role="status">{filtered.length} exercices associés à {muscleZoneLabels[atlasMuscle]} — résultats dans le catalogue ci-dessous.</p>}
      <div className="guide-category-tabs">
        {Object.keys(items).map((name) => (
          <button
            type="button"
            className={category === name ? "selected" : ""}
            onClick={() => setCategory(name)}
            key={name}
          >
            {name}
          </button>
        ))}
      </div>
      <div className="movement-guide-grid">
        {items[category].map((item) => (
          <article className="movement-guide-card" key={item.title}>
            <div>
              <h3>{item.title}</h3>
              <p>{item.description}</p>
              <div className="guide-points">
                <span>
                  <b>Installation</b> Position stable et amplitude adaptée.
                </span>
                <span>
                  <b>Exécution</b> Mouvement lent et contrôlé.
                </span>
                <span>
                  <b>Sécurité</b> Arrêtez en cas de douleur inhabituelle.
                </span>
              </div>
            </div>
            {item.image ? (
              <img src={item.image} alt={`Illustration ${item.title}`} />
            ) : (
              <div className="guide-placeholder">
                <Dumbbell />
              </div>
            )}
          </article>
        ))}
      </div>
      <section className="catalog-guide">
        <div className="section-title">
          <div>
            <span className="eyebrow">CATALOGUE COMPLET</span>
            <h2>Tous les exercices</h2>
          </div>
          <span className="count-pill">{catalog.length} mouvements</span>
        </div>
        <input
          className="guide-search"
          value={search}
          onChange={(event) => changeSearch(event.target.value)}
          placeholder="Rechercher un exercice…"
        />
        {visible.map((item) => (
          <button
            type="button"
            className="catalog-guide-row"
            key={item.id}
            onClick={(event) => {
              event.preventDefault();
              setSelectedExercise(item);
            }}
          >
            <div>
              <b>{item.name}</b>
              <small>
                {item.primaryMuscles?.map((muscle) => frenchLabel(muscle, frenchMuscles, muscle)).join(" · ") || "Muscles à préciser"} ·{" "}
                {frenchLabel(item.equipment, frenchEquipment, "Matériel libre")}
              </small>
            </div>
            <span>
              Voir la fiche <ChevronRight size={15} />
            </span>
          </button>
        ))}
        <div className="catalog-pagination">
          <button
            type="button"
            disabled={catalogPage === 1}
            onClick={() => setCatalogPage((page) => page - 1)}
          >
            Précédent
          </button>
          {Array.from({ length: pageCount }, (_, index) => index + 1).map(
            (page) => (
              <button
                type="button"
                className={page === catalogPage ? "selected" : ""}
                onClick={() => setCatalogPage(page)}
                key={page}
              >
                {page}
              </button>
            ),
          )}
          <button
            type="button"
            disabled={catalogPage === pageCount}
            onClick={() => setCatalogPage((page) => page + 1)}
          >
            Suivant
          </button>
        </div>
      </section>
      {selectedExercise && (
        <Dialog.Root
          open
          onOpenChange={(open) => !open && setSelectedExercise(null)}
        >
          <Dialog.Portal>
            <Dialog.Overlay className="modal-backdrop" />
            <Dialog.Content className="exercise-guide-dialog">
              <Dialog.Title>{selectedExercise.name}</Dialog.Title>
              <div className="exercise-guide-meta">
                  <span>{frenchLabel(selectedExercise.equipment, frenchEquipment, "Matériel libre")}</span>
              </div>
              <section className="guide-muscles">
                <h3>Muscles sollicités</h3>
                <div className="exercise-guide-meta">
                  {(selectedExercise.primaryMuscles ?? []).map((muscle) => (
                    <span key={`primary-${muscle}`}>{frenchLabel(muscle, frenchMuscles, muscle)} · principal</span>
                  ))}
                  {(selectedExercise.secondaryMuscles ?? []).map((muscle) => (
                    <span key={`secondary-${muscle}`}>{frenchLabel(muscle, frenchMuscles, muscle)} · secondaire</span>
                  ))}
                </div>
              </section>
              <div className="exercise-guide-images">
                {selectedExercise.images?.slice(0, 2).map((image, index) => (
                  <figure key={image}>
                    <img
                      src={catalogImage(image)}
                      alt={`${selectedExercise.name} — ${index === 0 ? "position de départ" : "position de fin"}`}
                    />
                    <figcaption>
                      {index === 0 ? "Position de départ" : "Position de fin"}
                    </figcaption>
                  </figure>
                ))}
              </div>
                <ol>
                  {frenchGuideInstructions(selectedExercise).map((instruction, index) => (
                    <li key={`${selectedExercise.id}-fr-${index}`}>{instruction}</li>
                  ))}
                </ol>
              <button
                type="button"
                className="primary wide"
                onClick={() => setSelectedExercise(null)}
              >
                Fermer
              </button>
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>
      )}
    </div>
  );
}

type TimerMode = "EMOM" | "AMRAP" | "Tabata" | "Intervalles" | "Circuit";
type ToolPreset = {
  mode: TimerMode;
  work: number;
  rest: number;
  rounds: number;
};

const timerPresets: Record<
  TimerMode,
  { work: number; rest: number; rounds: number }
> = {
  EMOM: { work: 60, rest: 0, rounds: 10 },
  AMRAP: { work: 600, rest: 0, rounds: 1 },
  Tabata: { work: 20, rest: 10, rounds: 8 },
  Intervalles: { work: 30, rest: 30, rounds: 10 },
  Circuit: { work: 45, rest: 15, rounds: 4 },
};

function WorkoutTools({ initial = null }: { initial?: ToolPreset | null }) {
  const first = initial ?? { mode: "EMOM" as TimerMode, ...timerPresets.EMOM };
  const [mode, setMode] = useState<TimerMode>(first.mode);
  const [work, setWork] = useState(first.work);
  const [rest, setRest] = useState(first.rest);
  const [rounds, setRounds] = useState(first.rounds);
  const [remaining, setRemaining] = useState(first.work);
  const [round, setRound] = useState(1);
  const [phase, setPhase] = useState<"work" | "rest" | "done">("work");
  const [running, setRunning] = useState(false);
  const [amrapRounds, setAmrapRounds] = useState(0);

  const configure = (next: TimerMode) => {
    const preset = timerPresets[next];
    setMode(next);
    setWork(preset.work);
    setRest(preset.rest);
    setRounds(preset.rounds);
    setRemaining(preset.work);
    setRound(1);
    setPhase("work");
    setRunning(false);
    setAmrapRounds(0);
  };
  const reset = () => {
    setRunning(false);
    setRound(1);
    setPhase("work");
    setRemaining(work);
    setAmrapRounds(0);
  };

  useEffect(() => {
    if (!initial) return;
    setMode(initial.mode);
    setWork(initial.work);
    setRest(initial.rest);
    setRounds(initial.rounds);
    setRemaining(initial.work);
    setRound(1);
    setPhase("work");
    setRunning(false);
  }, [initial]);

  useEffect(() => {
    if (!running || phase === "done") return;
    const timer = window.setInterval(() => {
      setRemaining((current) => {
        if (current > 1) return current - 1;
        if (
          mode === "AMRAP" ||
          (round >= rounds &&
            ((phase === "work" && rest === 0) || phase === "rest"))
        ) {
          setRunning(false);
          setPhase("done");
          return 0;
        }
        if (phase === "work" && rest > 0) {
          setPhase("rest");
          return rest;
        }
        setRound((value) => value + 1);
        setPhase("work");
        return work;
      });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [running, phase, mode, rest, round, rounds, work]);

  const updateWork = (value: number) => {
    const safe = Math.max(1, value || 1);
    setWork(safe);
    if (!running && phase === "work") setRemaining(safe);
  };
  const minutes = Math.floor(remaining / 60);
  const seconds = remaining % 60;
  const [guideCategory, setGuideCategory] = useState("Jambes");
  const guideItems: Record<
    string,
    { title: string; description: string; image?: string }[]
  > = {
    Jambes: [
      {
        title: "Squat au poids du corps",
        description:
          "Pieds stables, genoux dans l’axe des pieds, descente contrôlée et remontée en poussant dans le sol.",
        image: "/images/guides/squat-guide.png",
      },
      {
        title: "Hack squat",
        description:
          "Dos maintenu contre le dossier, pieds stables et amplitude contrôlée sans décoller les talons.",
      },
    ],
    Dos: [
      {
        title: "Traction",
        description:
          "Commencez suspendu, engagez les omoplates puis tirez la poitrine vers la barre sans balancer.",
      },
      {
        title: "Rowing",
        description:
          "Gardez le dos neutre et ramenez les coudes vers l’arrière en contrôlant le retour.",
      },
    ],
    Pectoraux: [
      {
        title: "Développé couché",
        description:
          "Omoplates serrées, pieds stables et trajectoire contrôlée vers le bas des pectoraux.",
      },
    ],
    Épaules: [
      {
        title: "Élévations latérales",
        description:
          "Bras légèrement fléchis, mouvement contrôlé et épaules détendues.",
      },
    ],
    Bras: [
      {
        title: "Curl biceps",
        description:
          "Coudes proches du corps, évitez l’élan et contrôlez la descente.",
      },
    ],
    Abdominaux: [
      {
        title: "Gainage",
        description:
          "Corps aligné, bassin neutre et respiration régulière sans creuser le bas du dos.",
      },
    ],
    Machines: [
      {
        title: "Réglage d’une machine",
        description:
          "Réglez le siège et les supports pour que l’axe de rotation corresponde à l’articulation travaillée.",
      },
    ],
  };

  return (
    <div className="page tools-page">
      <PageTitle
        eyebrow="CHRONOMÈTRES"
        title="Outils d’entraînement"
        text="Configurez un format et lancez-le immédiatement."
      />
      <div className="tool-tabs">
        {(Object.keys(timerPresets) as TimerMode[]).map((name) => (
          <button
            className={mode === name ? "selected" : ""}
            onClick={() => configure(name)}
            key={name}
          >
            {name}
          </button>
        ))}
      </div>
      <div className="tool-layout">
        <section className="timer-card">
          <span>
            {phase === "done"
              ? "TERMINÉ"
              : phase === "rest"
                ? "RÉCUPÉRATION"
                : mode}
          </span>
          <b className="timer-display">
            {String(minutes).padStart(2, "0")}:
            {String(seconds).padStart(2, "0")}
          </b>
          <p>
            {mode === "AMRAP"
              ? `${amrapRounds} tours complétés`
              : `Tour ${round} sur ${rounds}`}
          </p>
          <div className="timer-actions">
            <button className="secondary" onClick={reset}>
              <RotateCcw /> Réinitialiser
            </button>
            <button
              className="primary"
              disabled={phase === "done"}
              onClick={() => setRunning((value) => !value)}
            >
              {running ? "Pause" : "Démarrer"}
            </button>
          </div>
          {mode === "AMRAP" && phase !== "done" && (
            <button
              className="lap-button"
              onClick={() => setAmrapRounds((value) => value + 1)}
            >
              + Tour terminé
            </button>
          )}
        </section>
        <section className="tool-config">
          <h2>Configuration</h2>
          <label>
            Travail (secondes)
            <input
              type="number"
              min="1"
              value={work}
              disabled={running}
              onChange={(e) => updateWork(Number(e.target.value))}
            />
          </label>
          {mode !== "AMRAP" && (
            <label>
              Repos (secondes)
              <input
                type="number"
                min="0"
                value={rest}
                disabled={running}
                onChange={(e) => setRest(Math.max(0, Number(e.target.value)))}
              />
            </label>
          )}
          {mode !== "AMRAP" && (
            <label>
              Nombre de tours
              <input
                type="number"
                min="1"
                value={rounds}
                disabled={running}
                onChange={(e) => setRounds(Math.max(1, Number(e.target.value)))}
              />
            </label>
          )}
          <p>
            {mode === "EMOM"
              ? "Chaque tour commence toutes les minutes."
              : mode === "AMRAP"
                ? "Réalisez le maximum de tours avant la fin."
                : "Alternez automatiquement travail et récupération."}
          </p>
        </section>
      </div>
      <section className="movement-library">
        <span className="eyebrow">GUIDE DES MOUVEMENTS</span>
        <h2>Bibliothèque d’exercices</h2>
        <div className="guide-category-tabs">
          {Object.keys(guideItems).map((category) => (
            <button
              className={guideCategory === category ? "selected" : ""}
              onClick={() => setGuideCategory(category)}
              key={category}
            >
              {category}
            </button>
          ))}
        </div>
        <div className="movement-guide-grid">
          {guideItems[guideCategory].map((guide) => (
            <article className="movement-guide-card" key={guide.title}>
              <div>
                <h3>{guide.title}</h3>
                <p>{guide.description}</p>
                <div className="guide-points">
                  <span>
                    <b>Installation</b> Position stable et amplitude adaptée.
                  </span>
                  <span>
                    <b>Exécution</b> Mouvement lent et contrôlé.
                  </span>
                  <span>
                    <b>Sécurité</b> Arrêtez en cas de douleur inhabituelle.
                  </span>
                </div>
              </div>
              {guide.image ? (
                <img src={guide.image} alt={`Illustration ${guide.title}`} />
              ) : (
                <div className="guide-placeholder">
                  <Dumbbell />
                </div>
              )}
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}

function WorkoutScreen({
  workout,
  setWorkout,
  active,
  setActive,
  paused,
  setPaused,
  elapsedSeconds,
  completed,
  total,
  effort,
  setEffort,
  finish,
  onLaunchBlock,
}: {
  workout: Workout;
  setWorkout: (w: Workout) => void;
  active: boolean;
  setActive: (v: boolean) => void;
  paused: boolean;
  setPaused: React.Dispatch<React.SetStateAction<boolean>>;
  elapsedSeconds: number;
  completed: number;
  total: number;
  effort: Effort | null;
  setEffort: (e: Effort | null) => void;
  finish: (durationSeconds: number) => void;
  onLaunchBlock: (exercise: Exercise) => void;
}) {
  const progress = Math.round((completed / total) * 100);
  const isStructured = workout.exercises.some((exercise) => exercise.method);
  const progressUnit = isStructured ? "étapes" : "séries";
  const [demo, setDemo] = useState<Exercise | null>(null);
  const [selectedMuscle, setSelectedMuscle] = useState<MuscleZone | null>(null);
  const visibleExercises = selectedMuscle
    ? workout.exercises.filter((exercise) => {
        const muscles = inferExerciseMuscles(exercise);
        return muscles.primary.includes(selectedMuscle) || muscles.secondary.includes(selectedMuscle);
      })
    : workout.exercises;
  const elapsed = `${String(Math.floor(elapsedSeconds / 60)).padStart(2, "0")}:${String(elapsedSeconds % 60).padStart(2, "0")}`;
  const mark = (id: string, index: number) =>
    setWorkout({
      ...workout,
      exercises: workout.exercises.map((e) =>
        e.id === id
          ? {
              ...e,
              // A tap validates this set and every preceding one. Tapping an
              // already completed set reopens it and the following sets.
              done: index < e.done ? index : Math.min(e.sets, index + 1),
            }
          : e,
      ),
    });
  const updateSet = (
    id: string,
    index: number,
    field: "load" | "reps",
    value: string,
  ) =>
    setWorkout({
      ...workout,
      exercises: workout.exercises.map((exercise) => {
        if (exercise.id !== id) return exercise;
        const current = exercise.performed?.[index] ?? {
          load: exercise.load?.replace(" kg", "") ?? "",
          reps: exercise.reps,
        };
        return {
          ...exercise,
          performed: {
            ...exercise.performed,
            [index]: { ...current, [field]: value },
          },
        };
      }),
    });
  const setStatus = (exercise: Exercise, index: number) => {
    if (index >= exercise.done) return "À faire";
    const performed = exercise.performed?.[index];
    if (!performed) return "Conforme";
    const plannedLoad =
      Number.parseFloat(exercise.load?.replace(" kg", "") ?? "") || 0;
    const actualLoad = Number.parseFloat(performed.load) || 0;
    const plannedReps = Number.parseInt(exercise.reps, 10) || 0;
    const actualReps = Number.parseInt(performed.reps, 10) || 0;
    return actualLoad < plannedLoad || actualReps < plannedReps
      ? "Adaptée"
      : "Conforme";
  };
  return (
    <div className="page workout-page">
      <div className="workout-head">
        <div>
          <span className="eyebrow">SÉANCE DU JOUR</span>
          <h1>{workout.title}</h1>
          <p>
            {workout.subtitle} · {workout.duration} minutes
          </p>
        </div>
        {active && (
          <div className="session-time">
            <TimerReset />
            <div>
              <small>{paused ? "CHRONO EN PAUSE" : "TEMPS ÉCOULÉ"}</small>
              <b>{elapsed}</b>
            </div>
            <button
              className="secondary timer-toggle"
              onClick={() => setPaused((value) => !value)}
            >
              {paused ? "Reprendre" : "Pause"}
            </button>
          </div>
        )}
      </div>
      {!active ? (
        <div className="workout-preview">
          <div className="preview-top">
            <div>
              <h2>{workout.exercises.length} exercices</h2>
              <p>
                {total} {progressUnit} au total
              </p>
            </div>
            <span>
              <Clock3 />≈ {workout.duration} min
            </span>
          </div>
          <WorkoutMuscleMap exercises={workout.exercises} selected={selectedMuscle} onSelect={setSelectedMuscle} />
          {selectedMuscle && <div className="muscle-filter-result"><b>{visibleExercises.length} exercice{visibleExercises.length > 1 ? "s" : ""}</b> pour {muscleZoneLabels[selectedMuscle]}<button type="button" onClick={() => setSelectedMuscle(null)}>Effacer le filtre</button></div>}
          {visibleExercises.map((e) => (
            <div className="exercise-row" key={e.id}>
              <span className="order">{String(workout.exercises.findIndex((exercise) => exercise.id === e.id) + 1).padStart(2, "0")}</span>
              <button
                className="exercise-thumb"
                onClick={() => e.imageUrl && setDemo(e)}
              >
                {e.imageUrl ? (
                  <img src={e.imageUrl} alt={e.name} />
                ) : (
                  <Dumbbell />
                )}
              </button>
              <div className="exercise-name">
                <b>{e.name}</b>
                <small>{e.method || e.muscle}</small>
                {e.notes && <small className="exercise-note">{e.notes}</small>}
              </div>
              <div>
                <b>
                  {e.sets} × {e.reps}
                </b>
                <small>
                  {e.load ??
                    (isBodyweightExercise(e.name) ? "PDC" : "Charge libre")}
                </small>
              </div>
              <div>
                <small>Repos</small>
                <b>{e.rest ? `${e.rest}s` : "—"}</b>
              </div>
              <ChevronRight />
            </div>
          ))}
          <WarmupPlan workout={workout} />
          <button
            className="primary wide"
            onClick={() => {
              setPaused(false);
              setActive(true);
            }}
          >
            <Play fill="currentColor" />
            Démarrer
          </button>
        </div>
      ) : (
        <>
          <div className="session-progress">
            <div>
              <span>
                {completed} sur {total} {progressUnit}
              </span>
              <b>{progress}%</b>
            </div>
            <i>
              <span style={{ width: `${progress}%` }} />
            </i>
          </div>
          <div className="exercise-stack">
            {workout.exercises.map((e, i) => (
              <div
                className={
                  "exercise-live " + (e.done === e.sets ? "complete" : "")
                }
                key={e.id}
              >
                <div className="live-title">
                  <button
                    className="exercise-thumb"
                    onClick={() => e.imageUrl && setDemo(e)}
                  >
                    {e.imageUrl ? (
                      <img src={e.imageUrl} alt={e.name} />
                    ) : (
                      <Dumbbell />
                    )}
                  </button>
                  <div>
                    <small>EXERCICE {i + 1}</small>
                    <h3>{e.name}</h3>
                    {e.method && (
                      <span className="method-badge">{e.method}</span>
                    )}
                    {e.notes && (
                      <p className="live-note">
                        <b>Consignes :</b> {e.notes}
                      </p>
                    )}
                    {e.blockType &&
                      workout.exercises.findIndex(
                        (item) => item.blockKey === e.blockKey,
                      ) === i && (
                        <button
                          className="launch-block"
                          onClick={() => onLaunchBlock(e)}
                        >
                          <TimerReset /> Lancer le bloc {e.blockType}
                        </button>
                      )}
                  </div>
                  <button onClick={() => e.imageUrl && setDemo(e)}>
                    {e.imageUrl ? <Play /> : <MoreHorizontal />}
                  </button>
                </div>
                <div className="set-header">
                  <span>SÉRIE</span>
                  <span>PRÉVU</span>
                  <span>KG</span>
                  <span>REPS</span>
                  <span>STATUT</span>
                </div>
                {Array.from({ length: e.sets }).map((_, j) => (
                  <div
                    className={"set-row " + (j < e.done ? "checked" : "")}
                    key={j}
                  >
                    <b>{j + 1}</b>
                    <span>
                      {e.load ?? (isBodyweightExercise(e.name) ? "PDC" : "—")} ×{" "}
                      {e.reps}
                    </span>
                    <label className="set-entry load-entry">
                      <small>Charge réalisée</small>
                      <input
                        inputMode="decimal"
                        aria-label={`Charge réalisée, série ${j + 1}`}
                        value={e.performed?.[j]?.load ?? ""}
                        placeholder={
                          e.load?.replace(" kg", "") ??
                          (isBodyweightExercise(e.name) ? "PDC" : "—")
                        }
                        onChange={(event) =>
                          updateSet(e.id, j, "load", event.target.value)
                        }
                      />
                    </label>
                    <label className="set-entry reps-entry">
                      <small>Répétitions réalisées</small>
                      <input
                        inputMode="numeric"
                        aria-label={`Répétitions réalisées, série ${j + 1}`}
                        value={e.performed?.[j]?.reps ?? ""}
                        placeholder={e.reps}
                        onChange={(event) =>
                          updateSet(e.id, j, "reps", event.target.value)
                        }
                      />
                    </label>
                    <div
                      className={`set-status ${setStatus(e, j).toLowerCase()}`}
                    >
                      <span>{setStatus(e, j)}</span>
                      <button
                        className="set-done-button"
                        onClick={() => mark(e.id, j)}
                        title={j < e.done ? "Décocher cette série" : "Marquer la série comme faite"}
                        aria-pressed={j < e.done}
                      >
                        <Check />
                        <span>{j < e.done ? "Fait" : "Valider"}</span>
                      </button>
                    </div>
                  </div>
                ))}
                {e.rest > 0 && (
                  <div className="rest-note">
                    <Clock3 />
                    Repos indiqué : {e.rest} secondes
                  </div>
                )}
              </div>
            ))}
          </div>
          <div className="finish-panel">
            <div>
              <b>Comment était la séance ?</b>
              <div className="efforts">
                {(["Facile", "Bien", "Difficile"] as Effort[]).map((e) => (
                  <button
                    className={effort === e ? "selected" : ""}
                    onClick={() => setEffort(e)}
                    key={e}
                  >
                    {e}
                  </button>
                ))}
              </div>
            </div>
            {completed === total ? (
              <div className="workout-complete-message">
                Toutes les séries sont validées. Séance prête à être
                enregistrée.
              </div>
            ) : (
              <div className="workout-complete-message">
                Validez encore {total - completed} série
                {total - completed > 1 ? "s" : ""} pour terminer.
              </div>
            )}
            <button
              className="primary"
              onClick={() => {
                if (
                  completed !== total &&
                  !window.confirm(
                    `Il reste ${total - completed} série${total - completed > 1 ? "s" : ""} non validée${total - completed > 1 ? "s" : ""}. Terminer quand même ?`,
                  )
                ) return;
                finish(elapsedSeconds);
              }}
            >
              {completed === total ? "Terminer la séance" : "Terminer quand même"}
            </button>
          </div>
        </>
      )}
      {demo && <ExerciseDemo exercise={demo} onClose={() => setDemo(null)} />}
    </div>
  );
}

function WarmupPlan({ workout }: { workout: Workout }) {
  const names = workout.exercises
    .map((exercise) => exercise.name.toLowerCase())
    .join(" ");
  const lower =
    /squat|hack|presse|leg |hip thrust|fessier|mollet|ischio|quadriceps|cuisses/.test(
      names,
    );
  const upperPull = /traction|tirage|row|rowing|dos|biceps|curl/.test(names);
  const focus = lower
    ? "Bas du corps"
    : upperPull
      ? "Dos et tirage"
      : "Haut du corps";
  const exercises = buildWarmupItems(names);
  return (
    <section className="warmup-plan">
      <div className="section-title">
        <div>
          <span className="eyebrow">AVANT DE COMMENCER</span>
          <h2>Échauffement recommandé</h2>
        </div>
        <span className="count-pill">{focus}</span>
      </div>
      <p className="muted-copy">
        Préparez progressivement les articulations et les muscles sollicités,
        sans vous fatiguer.
      </p>
      <div className="warmup-list">
        {exercises.map(([name, detail], index) => (
          <div className="warmup-row" key={`${name}-${index}`}>
            <span>{String(index + 1).padStart(2, "0")}</span>
            <b>{name}</b>
            <small>{detail}</small>
          </div>
        ))}
      </div>
      <p className="warmup-note">
        Adaptez ou arrêtez l’exercice en cas de douleur inhabituelle.
      </p>
    </section>
  );
}

function buildWarmupItems(names: string): Array<[string, string]> {
  const lower =
    /squat|hack|presse|leg |hip thrust|fessier|mollet|ischio|quadriceps|cuisses/.test(
      names,
    );
  const upperPull = /traction|tirage|row|rowing|dos|biceps|curl/.test(names);
  return lower
    ? [
        ["Vélo", "5 min · intensité légère"],
        ["Mobilité chevilles et hanches", "2 × 10 par côté"],
        ["Squat au poids du corps", "2 × 8 répétitions"],
        ["Glute bridge", "2 × 12 répétitions"],
        ["Marche latérale avec élastique", "2 × 10 par côté"],
        [
          "Série de préparation du premier exercice",
          "à vide, puis 50 % et 70 % de la charge prévue",
        ],
      ]
    : upperPull
      ? [
          ["Rameur ou vélo", "5 min · intensité légère"],
          ["Cercles d’épaules", "10 vers l’avant et 10 vers l’arrière"],
          ["Band pull-aparts", "2 × 12 répétitions"],
          ["Scapular pull-ups ou tirage élastique", "2 × 8 répétitions"],
          [
            "Série de préparation du premier tirage",
            "charge légère, puis progressive",
          ],
        ]
      : [
          ["Vélo ou rameur", "5 min · intensité légère"],
          ["Cercles d’épaules", "10 dans chaque direction"],
          ["Rotations externes avec élastique", "2 × 10 par côté"],
          ["Pompes faciles", "2 × 8 répétitions"],
          [
            "Série de préparation du premier exercice",
            "charge légère, puis progressive",
          ],
        ];
}

function ExerciseDemo({
  exercise,
  onClose,
}: {
  exercise: Exercise;
  onClose: () => void;
}) {
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="demo-modal">
        <div className="modal-head">
          <div>
            <span className="eyebrow">DÉMONSTRATION</span>
            <h2>{exercise.name}</h2>
          </div>
          <button onClick={onClose}>
            <X />
          </button>
        </div>
        <div className="demo-frames">
          {exercise.imageUrl && (
            <figure>
              <img src={exercise.imageUrl} alt={`Départ — ${exercise.name}`} />
              <figcaption>Position de départ</figcaption>
            </figure>
          )}
          {exercise.imageUrlEnd && (
            <figure>
              <img
                src={exercise.imageUrlEnd}
                alt={`Arrivée — ${exercise.name}`}
              />
              <figcaption>Position d’arrivée</figcaption>
            </figure>
          )}
        </div>
        {exercise.instructions?.length ? (
          <ol>
            {exercise.instructions.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
        ) : (
          <p className="media-notice">
            Démonstration issue du catalogue public free-exercise-db. Vérifiez
            toujours la technique avec un professionnel qualifié.
          </p>
        )}
        <div className="media-source">
          <span>Source : free-exercise-db · Unlicense</span>
          {exercise.sourceUrl && (
            <a href={exercise.sourceUrl} target="_blank" rel="noreferrer">
              Voir la source
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

function Progress() {
  type LogRow = {
    id: string;
    completed_at: string | null;
    duration_seconds: number;
    effort: string | null;
    workouts: { title: string } | null;
    set_logs: { load: number | null; reps: number | null }[];
  };
  const [logs, setLogs] = useState<LogRow[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const user = firebaseAuth.currentUser;
    if (!user) {
      setLoading(false);
      return;
    }
    loadFirebaseProgress(user.uid)
      .then((data) => {
        setLogs(data as LogRow[]);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);
  const volume = logs.reduce(
    (total, log) =>
      total +
      (log.set_logs ?? []).reduce(
        (sum, set) => sum + (set.load ?? 0) * (set.reps ?? 0),
        0,
      ),
    0,
  );
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);
  const thisMonth = logs.filter(
    (log) => log.completed_at && new Date(log.completed_at) >= monthStart,
  ).length;
  const chartValues = logs
    .slice(0, 8)
    .reverse()
    .map((log) =>
      (log.set_logs ?? []).reduce(
        (sum, set) => sum + (set.load ?? 0) * (set.reps ?? 0),
        0,
      ),
    );
  const chartMax = Math.max(...chartValues, 1);
  return (
    <div className="page">
      <PageTitle
        eyebrow="VOTRE ÉVOLUTION"
        title="Progression"
        text="L’essentiel pour voir que vos efforts portent leurs fruits."
      />
      <div className="stats-grid">
        <Stat label="Séances" value={String(logs.length)} note="enregistrées" />
        <Stat
          label="Ce mois-ci"
          value={String(thisMonth)}
          note="séances terminées"
        />
        <Stat
          label="Volume total"
          value={`${(volume / 1000).toFixed(1)} t`}
          note="charges × répétitions"
        />
        <Stat
          label="Séances difficiles"
          value={String(
            logs.filter((log) => log.effort === "Difficile").length,
          )}
          note="à surveiller"
        />
      </div>
      <section className="chart-card">
        <div className="section-title">
          <div>
            <span className="eyebrow">VOLUME PAR SÉANCE</span>
            <h2>Votre charge de travail</h2>
          </div>
          <select>
            <option>8 dernières semaines</option>
          </select>
        </div>
        <div className="chart">
          {chartValues.length ? (
            chartValues.map((value, index) => (
              <span
                key={index}
                style={{
                  height: `${Math.max(8, Math.round((value / chartMax) * 100))}%`,
                }}
              />
            ))
          ) : (
            <div className="chart-empty">
              Terminez une séance pour afficher votre progression.
            </div>
          )}
        </div>
        <div className="chart-labels">
          <span>Anciennes séances</span>
          <span>Aujourd’hui</span>
        </div>
      </section>
      <section>
        <div className="section-title">
          <h2>Historique récent</h2>
        </div>
        {loading ? (
          <div
            className="skeleton-history"
            aria-label="Chargement de l’historique"
          >
            {[1, 2, 3].map((item) => (
              <div className="skeleton-history-row" key={item}>
                <span />
                <div>
                  <i />
                  <i />
                </div>
              </div>
            ))}
          </div>
        ) : logs.length === 0 ? (
          <div className="data-empty">
            <Activity />
            <h3>Aucune séance terminée</h3>
            <p>Vos résultats apparaîtront ici après votre première séance.</p>
          </div>
        ) : (
          logs.map((log) => (
            <div className="history-row" key={log.id}>
              <span className="mini-icon">
                <Check />
              </span>
              <div>
                <b>{log.workouts?.title ?? "Séance"}</b>
                <small>
                  {log.completed_at
                    ? new Intl.DateTimeFormat("fr-FR", {
                        dateStyle: "medium",
                      }).format(new Date(log.completed_at))
                    : "Date inconnue"}{" "}
                  · {log.set_logs?.length ?? 0} séries
                  {log.duration_seconds
                    ? ` · ${Math.floor(log.duration_seconds / 60)} min ${log.duration_seconds % 60}s`
                    : ""}
                </small>
              </div>
              <span>Terminée</span>
              <ChevronRight />
            </div>
          ))
        )}
      </section>
    </div>
  );
}

type CoachClientView = {
  id: string;
  name: string;
  initials: string;
  color: string;
  lastActivity: string | null;
  completedThisWeek: number;
};

function formatActivityDate(value: string | null) {
  if (!value) return "Aucune activité";
  return new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium" }).format(
    new Date(value),
  );
}

function useCoachClients() {
  const [clients, setClients] = useState<CoachClientView[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const load = async () => {
      try { setClients(await loadCoachClients()); } catch { setClients([]); }
      setLoading(false);
    };
    void load();
  }, []);
  return { clients, loading };
}

function InviteClientButton({ notify }: { notify: (message: string) => void }) {
  const [inviteUrl, setInviteUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const createInvite = async () => {
    setBusy(true);
    try {
      const token = await createCoachInvite();
      setInviteUrl(`${window.location.origin}${window.location.pathname}?invite=${token}`);
    } catch (error) { notify(error instanceof Error ? error.message : "Invitation impossible"); }
    finally { setBusy(false); }
  };
  const copy = async () => {
    await navigator.clipboard.writeText(inviteUrl);
    notify("Lien d’invitation copié");
  };
  return (
    <>
      <button
        className="primary"
        disabled={busy}
        onClick={() => void createInvite()}
      >
        <Plus /> {busy ? "Création…" : "Inviter un client"}
      </button>
      <Dialog.Root
        open={Boolean(inviteUrl)}
        onOpenChange={(open) => !open && setInviteUrl("")}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="modal-backdrop" />
          <Dialog.Content
            className="confirm-dialog invite-dialog"
            aria-describedby="invite-description"
          >
            <Dialog.Title>Inviter un client</Dialog.Title>
            <Dialog.Description id="invite-description">
              Envoyez ce lien à votre client. Il restera valable pendant 7
              jours.
            </Dialog.Description>
            <label>
              Lien personnel
              <input
                readOnly
                value={inviteUrl}
                onFocus={(event) => event.currentTarget.select()}
              />
            </label>
            <div className="modal-actions">
              <Dialog.Close asChild>
                <button className="secondary">Fermer</button>
              </Dialog.Close>
              <button className="primary" onClick={() => void copy()}>
                Copier le lien
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}

function Coach({
  screen,
  setScreen,
  notify,
  displayName,
  onImport,
  selectedClientId,
  onSelectClient,
  selectedProgramId,
  onSelectProgram,
}: {
  screen: Screen;
  setScreen: (s: Screen) => void;
  notify: (s: string) => void;
  displayName: string;
  onImport: () => void;
  selectedClientId: string;
  onSelectClient: (id: string) => void;
  selectedProgramId: string;
  onSelectProgram: (id: string) => void;
}) {
  const { clients: coachClients, loading } = useCoachClients();
  if (screen === "clients")
    return <Clients notify={notify} onOpen={onSelectClient} />;
  if (screen === "client-detail" && selectedClientId)
    return (
      <ClientDetail
        clientId={selectedClientId}
        onBack={() => setScreen("clients")}
        notify={notify}
      />
    );
  if (screen === "programs")
    return (
      <ProgramsLive
        notify={notify}
        onImport={onImport}
        onOpen={onSelectProgram}
      />
    );
  if (screen === "program-detail" && selectedProgramId)
    return (
      <ProgramEditor
        programId={selectedProgramId}
        onBack={() => setScreen("programs")}
        notify={notify}
      />
    );
  if (screen === "progress") return <Progress />;
  const weeklySessions = coachClients.reduce(
    (sum, client) => sum + client.completedThisWeek,
    0,
  );
  const activeThisWeek = coachClients.filter(
    (client) => client.completedThisWeek > 0,
  ).length;
  const needsAttention = coachClients.filter(
    (client) =>
      !client.lastActivity ||
      Date.now() - new Date(client.lastActivity).getTime() > 7 * 86400000,
  );
  return (
    <div className="page">
      <div className="welcome coach-hero-banner">
        <div>
          <span className="eyebrow">
            {new Intl.DateTimeFormat("fr-FR", {
              weekday: "long",
              day: "numeric",
              month: "long",
            })
              .format(new Date())
              .toUpperCase()}
          </span>
          <h1>
            Bonjour {displayName.split(" ")[0]} <span>👋</span>
          </h1>
          <p>Voici ce qui mérite votre attention aujourd’hui.</p>
        </div>
        <InviteClientButton notify={notify} />
      </div>
      <div className="coach-stats">
        <Stat
          label="Clients actifs"
          value={String(coachClients.length)}
          note={loading ? "Chargement…" : "Relations Supabase"}
        />
        <Stat
          label="Séances cette semaine"
          value={String(weeklySessions)}
          note="Séances réellement terminées"
        />
        <Stat
          label="Actifs cette semaine"
          value={String(activeThisWeek)}
          note={`sur ${coachClients.length} clients`}
        />
      </div>
      <section>
        <div className="section-title">
          <div>
            <span className="eyebrow">BOÎTE D’ATTENTION</span>
            <h2>À traiter aujourd’hui</h2>
          </div>
          <span className="count-pill">
            {needsAttention.length} élément
            {needsAttention.length > 1 ? "s" : ""}
          </span>
        </div>
        <div className="attention-list">
          {needsAttention.length === 0 ? (
            <div className="data-empty">
              Aucune alerte réelle pour le moment.
            </div>
          ) : (
            needsAttention.map((c, i) => (
              <button
                className="attention"
                key={c.id}
                onClick={() => onSelectClient(c.id)}
              >
                <span
                  className={
                    "status " + (i === 0 ? "green" : i === 1 ? "red" : "orange")
                  }
                >
                  {i === 1 ? <CircleAlert /> : <Activity />}
                </span>
                <span className="avatar" style={{ background: c.color }}>
                  {c.initials}
                </span>
                <div>
                  <b>{c.name}</b>
                  <p>
                    {c.lastActivity
                      ? "Aucune séance depuis plus de 7 jours"
                      : "Aucune séance enregistrée"}
                  </p>
                </div>
                <span className="attention-action">
                  {i === 0
                    ? "Voir le bilan"
                    : i === 1
                      ? "Examiner"
                      : "Relancer"}
                  <ChevronRight />
                </span>
              </button>
            ))
          )}
        </div>
      </section>
      <section>
        <div className="section-title">
          <div>
            <span className="eyebrow">ACTIVITÉ DES CLIENTS</span>
            <h2>Cette semaine</h2>
          </div>
          <button className="text-button" onClick={() => setScreen("clients")}>
            Tous les clients
          </button>
        </div>
        <div className="client-table">
          <div className="table-head">
            <span>CLIENT</span>
            <span>OBJECTIF</span>
            <span>DERNIÈRE ACTIVITÉ</span>
            <span>ADHÉRENCE</span>
            <span>ÉVOLUTION</span>
          </div>
          {coachClients.map((c) => (
            <button
              className="table-row client-table-button"
              key={c.id}
              onClick={() => onSelectClient(c.id)}
            >
              <div>
                <span className="avatar" style={{ background: c.color }}>
                  {c.initials}
                </span>
                <b>{c.name}</b>
              </div>
              <span>Non renseigné</span>
              <span>{formatActivityDate(c.lastActivity)}</span>
              <div>
                <i>
                  <span
                    style={{ width: c.completedThisWeek ? "100%" : "0%" }}
                  />
                </i>
                <b>
                  {c.completedThisWeek} séance
                  {c.completedThisWeek > 1 ? "s" : ""}
                </b>
              </div>
              <span className={c.completedThisWeek ? "positive" : "negative"}>
                {c.completedThisWeek ? "Actif" : "Inactif"}
              </span>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}

function ClientDetail({
  clientId,
  onBack,
  notify,
}: {
  clientId: string;
  onBack: () => void;
  notify: (message: string) => void;
}) {
  type Assignment = {
    id: string;
    starts_on: string;
    active: boolean;
    programs: {
      id: string;
      title: string;
      workouts: { id: string; title: string }[];
    } | null;
  };
  type ClientLog = {
    id: string;
    completed_at: string | null;
    effort: string | null;
    workouts: { title: string } | null;
    set_logs: { load: number | null; reps: number | null }[];
  };
  type PrivateNote = { id: string; content: string; created_at: string };
  const [name, setName] = useState("Client");
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [logs, setLogs] = useState<ClientLog[]>([]);
  const [notes, setNotes] = useState<PrivateNote[]>([]);
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(true);
  const [savingNote, setSavingNote] = useState(false);
  const [confirmEnd, setConfirmEnd] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const data = await loadClientDetails(clientId);
      setName(data.name); setAssignments(data.assignments as Assignment[]);
      setLogs(data.logs as ClientLog[]); setNotes(data.notes as PrivateNote[]);
    } catch (error) { notify(error instanceof Error ? error.message : "Chargement impossible"); }
    setLoading(false);
  };
  useEffect(() => {
    void load();
  }, [clientId]);

  const addNote = async () => {
    if (!note.trim()) return;
    setSavingNote(true);
    try { await addClientNote(clientId, note.trim()); }
    catch (error) { notify(error instanceof Error ? error.message : "Enregistrement impossible"); setSavingNote(false); return; }
    setSavingNote(false);
    setNote("");
    notify("Note privée enregistrée");
    void load();
  };
  const deactivate = async (assignmentId: string) => {
    try {
      await deactivateAssignment(assignmentId);
      notify("Programme désactivé");
      void load();
    } catch (error) { notify(error instanceof Error ? error.message : "Modification impossible"); }
  };
  const endCoaching = async () => {
    try { await endFirebaseCoaching(clientId); }
    catch (error) { notify(error instanceof Error ? error.message : "Modification impossible"); return; }
    setConfirmEnd(false);
    notify("Accompagnement terminé");
    onBack();
  };
  const totalVolume = logs.reduce(
    (total, log) =>
      total +
      (log.set_logs ?? []).reduce(
        (sum, set) => sum + (set.load ?? 0) * (set.reps ?? 0),
        0,
      ),
    0,
  );
  const initials = name
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <div className="page">
      <button className="text-button back-button" onClick={onBack}>
        <ArrowLeft /> Retour aux clients
      </button>
      <div className="client-detail-head">
        <span className="avatar large">{initials}</span>
        <div>
          <span className="eyebrow">SUIVI CLIENT</span>
          <h1>{name}</h1>
          <p>
            {logs.length
              ? `Dernière séance : ${formatActivityDate(logs[0].completed_at)}`
              : "Aucune séance terminée"}
          </p>
        </div>
        <button className="danger-outline" onClick={() => setConfirmEnd(true)}>
          Terminer l’accompagnement
        </button>
      </div>
      {loading ? (
        <div className="data-empty">Chargement du suivi…</div>
      ) : (
        <>
          <div className="coach-stats">
            <Stat
              label="Séances terminées"
              value={String(logs.length)}
              note="30 dernières maximum"
            />
            <Stat
              label="Volume enregistré"
              value={`${Math.round(totalVolume).toLocaleString("fr-FR")} kg`}
              note="Charge × répétitions"
            />
            <Stat
              label="Programmes actifs"
              value={String(assignments.filter((item) => item.active).length)}
              note="Attribués par le coach"
            />
          </div>
          <div className="client-detail-grid">
            <section className="detail-card">
              <h2>Programmes attribués</h2>
              {assignments.length === 0 ? (
                <p className="muted-copy">Aucun programme attribué.</p>
              ) : (
                assignments.map((assignment) => (
                  <div className="assignment-row" key={assignment.id}>
                    <div>
                      <b>{assignment.programs?.title ?? "Programme"}</b>
                      <small>
                        Depuis le{" "}
                        {new Intl.DateTimeFormat("fr-FR").format(
                          new Date(assignment.starts_on),
                        )}{" "}
                        · {assignment.programs?.workouts?.length ?? 0} séances
                      </small>
                    </div>
                    {assignment.active ? (
                      <button onClick={() => void deactivate(assignment.id)}>
                        Désactiver
                      </button>
                    ) : (
                      <span>Inactif</span>
                    )}
                  </div>
                ))
              )}
            </section>
            <section className="detail-card">
              <h2>Notes privées</h2>
              <textarea
                rows={4}
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder="Observation, adaptation, point à surveiller…"
              />
              <button
                className="primary"
                disabled={!note.trim() || savingNote}
                onClick={() => void addNote()}
              >
                {savingNote ? "Enregistrement…" : "Ajouter la note"}
              </button>
              <div className="private-notes">
                {notes.map((item) => (
                  <article key={item.id}>
                    <p>{item.content}</p>
                    <small>{formatActivityDate(item.created_at)}</small>
                  </article>
                ))}
              </div>
            </section>
          </div>
          <section className="detail-card client-history">
            <h2>Historique récent</h2>
            {logs.length === 0 ? (
              <p className="muted-copy">Aucune séance terminée.</p>
            ) : (
              logs.map((log) => (
                <div className="history-row" key={log.id}>
                  <span className="mini-icon">
                    <Check />
                  </span>
                  <div>
                    <b>{log.workouts?.title ?? "Séance"}</b>
                    <small>
                      {formatActivityDate(log.completed_at)} ·{" "}
                      {log.set_logs?.length ?? 0} séries
                    </small>
                  </div>
                  <span>{log.effort ?? "Terminé"}</span>
                </div>
              ))
            )}
          </section>
        </>
      )}
      <AlertDialog.Root open={confirmEnd} onOpenChange={setConfirmEnd}>
        <AlertDialog.Portal>
          <AlertDialog.Overlay className="modal-backdrop" />
          <AlertDialog.Content className="confirm-dialog">
            <AlertDialog.Title>Terminer l’accompagnement ?</AlertDialog.Title>
            <AlertDialog.Description>
              Les programmes actifs seront désactivés et le membre repassera en
              entraînement autonome.
            </AlertDialog.Description>
            <div className="modal-actions">
              <AlertDialog.Cancel asChild>
                <button className="secondary">Annuler</button>
              </AlertDialog.Cancel>
              <button
                className="danger-button"
                onClick={() => void endCoaching()}
              >
                Confirmer
              </button>
            </div>
          </AlertDialog.Content>
        </AlertDialog.Portal>
      </AlertDialog.Root>
    </div>
  );
}

function Clients({
  notify,
  onOpen,
}: {
  notify: (s: string) => void;
  onOpen: (id: string) => void;
}) {
  const [query, setQuery] = useState("");
  const { clients: coachClients, loading } = useCoachClients();
  const list = useMemo(
    () =>
      coachClients.filter((c) =>
        c.name.toLowerCase().includes(query.toLowerCase()),
      ),
    [query, coachClients],
  );
  return (
    <div className="page">
      <div className="page-actions">
        <PageTitle
          eyebrow="ACCOMPAGNEMENT"
          title="Clients"
          text="Suivez les personnes qui ont besoin de vous."
        />
        <InviteClientButton notify={notify} />
      </div>
      <div className="search">
        <Search />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Rechercher un client…"
        />
      </div>
      {loading ? (
        <div className="data-empty">Chargement des clients…</div>
      ) : list.length === 0 ? (
        <div className="data-empty">
          <UsersRound />
          <h3>Aucun client connecté</h3>
          <p>
            La liste se remplira depuis les relations coach-client Supabase.
          </p>
        </div>
      ) : (
        <div className="client-cards">
          {list.map((c) => (
            <article key={c.id}>
              <div className="client-card-top">
                <span className="avatar large" style={{ background: c.color }}>
                  {c.initials}
                </span>
                <button>
                  <MoreHorizontal />
                </button>
              </div>
              <h3>{c.name}</h3>
              <p>Dernière activité : {formatActivityDate(c.lastActivity)}</p>
              {(!c.lastActivity ||
                Date.now() - new Date(c.lastActivity).getTime() >
                  7 * 86400000) && (
                <div className="client-alert">
                  <CircleAlert />
                  {c.lastActivity
                    ? "Aucune séance depuis plus de 7 jours"
                    : "Aucune séance enregistrée"}
                </div>
              )}
              <div className="client-kpis">
                <div>
                  <small>Cette semaine</small>
                  <b>
                    {c.completedThisWeek} séance
                    {c.completedThisWeek > 1 ? "s" : ""}
                  </b>
                </div>
                <div>
                  <small>Statut</small>
                  <b className={c.completedThisWeek ? "positive" : "negative"}>
                    {c.completedThisWeek ? "Actif" : "Inactif"}
                  </b>
                </div>
              </div>
              <button className="secondary" onClick={() => onOpen(c.id)}>
                Voir le suivi
                <ChevronRight />
              </button>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
type ProgramRecord = {
  id: string;
  title: string;
  description: string | null;
  duration_weeks: number | null;
  created_at: string;
  workouts: { id: string }[];
  program_assignments: { id: string }[];
};

function AssignProgramButton({
  program,
  clients,
  onAssigned,
}: {
  program: ProgramRecord;
  clients: CoachClientView[];
  onAssigned: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [clientId, setClientId] = useState("");
  const [startsOn, setStartsOn] = useState(
    new Date().toISOString().slice(0, 10),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const assign = async () => {
    if (!clientId) return;
    setBusy(true);
    setError("");
    try { await assignProgram(program.id, clientId, startsOn); }
    catch (assignError) { setError(assignError instanceof Error ? assignError.message : "Attribution impossible"); setBusy(false); return; }
    setBusy(false);
    setOpen(false);
    setClientId("");
    onAssigned();
  };
  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <button
          className="primary"
          disabled={!clients.length}
          title={!clients.length ? "Invitez d’abord un client" : ""}
        >
          <UsersRound /> Attribuer
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="modal-backdrop" />
        <Dialog.Content
          className="confirm-dialog assignment-dialog"
          aria-describedby="assignment-description"
        >
          <Dialog.Title>Attribuer « {program.title} »</Dialog.Title>
          <Dialog.Description id="assignment-description">
            Le programme apparaîtra dans l’espace du client.
          </Dialog.Description>
          <label>
            Client
            <select
              value={clientId}
              onChange={(event) => setClientId(event.target.value)}
            >
              <option value="">Choisir un client</option>
              {clients.map((client) => (
                <option value={client.id} key={client.id}>
                  {client.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Date de début
            <input
              type="date"
              value={startsOn}
              onChange={(event) => setStartsOn(event.target.value)}
            />
          </label>
          {error && (
            <div className="data-error">
              <CircleAlert />
              {error}
            </div>
          )}
          <div className="modal-actions">
            <Dialog.Close asChild>
              <button className="secondary">Annuler</button>
            </Dialog.Close>
            <button
              className="primary"
              disabled={!clientId || busy}
              onClick={() => void assign()}
            >
              {busy ? "Attribution…" : "Confirmer"}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

type EditorBlock = {
  id: string;
  title: string;
  block_type: TimerMode;
  duration_seconds: number | null;
  work_seconds: number | null;
  rest_seconds: number;
  rounds: number;
};
type EditorLine = {
  id: string;
  position: number;
  sets: number;
  reps: string;
  rest_seconds: number;
  block_id: string | null;
  exercises: { name: string } | null;
};
type EditorWorkout = {
  id: string;
  title: string;
  position: number;
  estimated_minutes: number | null;
  workout_blocks: EditorBlock[];
  workout_exercises: EditorLine[];
};

function ProgramEditor({
  programId,
  onBack,
  notify,
}: {
  programId: string;
  onBack: () => void;
  notify: (message: string) => void;
}) {
  const [title, setTitle] = useState("Programme");
  const [workouts, setWorkouts] = useState<EditorWorkout[]>([]);
  const [selectedWorkoutId, setSelectedWorkoutId] = useState("");
  const [loading, setLoading] = useState(true);
  const [newWorkoutTitle, setNewWorkoutTitle] = useState("");
  const [exerciseName, setExerciseName] = useState("");
  const [sets, setSets] = useState(3);
  const [reps, setReps] = useState("10");
  const [restSeconds, setRestSeconds] = useState(90);
  const [blockId, setBlockId] = useState("");
  const [blockType, setBlockType] = useState<TimerMode>("EMOM");
  const [blockTitle, setBlockTitle] = useState("EMOM");
  const [blockWork, setBlockWork] = useState(60);
  const [blockRest, setBlockRest] = useState(0);
  const [blockRounds, setBlockRounds] = useState(10);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setLoading(true);
    let data;
    try { data = await loadProgramEditor(programId); }
    catch (error) { setLoading(false); notify(error instanceof Error ? error.message : "Programme introuvable"); return; }
    setLoading(false);
    const next = ((data.workouts ?? []) as unknown as EditorWorkout[])
      .sort((a, b) => a.position - b.position)
      .map((workout) => ({
        ...workout,
        workout_blocks: [...(workout.workout_blocks ?? [])],
        workout_exercises: [...(workout.workout_exercises ?? [])].sort(
          (a, b) => a.position - b.position,
        ),
      }));
    setTitle(data.title);
    setWorkouts(next);
    setSelectedWorkoutId((current) =>
      current && next.some((item) => item.id === current)
        ? current
        : (next[0]?.id ?? ""),
    );
  };
  useEffect(() => {
    void load();
  }, [programId]);
  const selected = workouts.find((item) => item.id === selectedWorkoutId);

  const createWorkout = async () => {
    if (!newWorkoutTitle.trim()) return;
    setBusy(true);
    let created;
    try { created = await createProgramWorkout(programId, newWorkoutTitle.trim(), workouts.length + 1); }
    catch (error) { setBusy(false); notify(error instanceof Error ? error.message : "Création impossible"); return; }
    setBusy(false);
    setNewWorkoutTitle(""); await load(); setSelectedWorkoutId(created.id);
  };
  const addExercise = async () => {
    if (!selected || !exerciseName.trim()) return;
    setBusy(true);
    try { await addProgramExercise(selected.id, { id: crypto.randomUUID(), position: selected.workout_exercises.length + 1, sets, reps, rest_seconds: restSeconds, rest: restSeconds, block_id: blockId || null, exercises: { name: exerciseName.trim() }, name: exerciseName.trim(), done: 0 }); }
    catch (error) { setBusy(false); notify(error instanceof Error ? error.message : "Ajout impossible"); return; }
    setBusy(false);
    setExerciseName(""); void load();
  };
  const addBlock = async () => {
    if (!selected || !blockTitle.trim()) return;
    setBusy(true);
    try { await addProgramBlock(selected.id, {
      id: crypto.randomUUID(),
      block_key: `${blockType.toLowerCase()}-${crypto.randomUUID().slice(0, 8)}`,
      title: blockTitle.trim(),
      block_type: blockType,
      position: selected.workout_blocks.length + 1,
      duration_seconds:
        blockType === "AMRAP" ? blockWork : blockWork * blockRounds,
      work_seconds: blockWork,
      rest_seconds: blockRest,
      rounds: blockRounds,
    }); } catch (error) { setBusy(false); notify(error instanceof Error ? error.message : "Ajout impossible"); return; }
    setBusy(false);
    notify("Bloc chronométré ajouté"); void load();
  };
  const removeLine = async (lineId: string) => {
    if (!selected) return;
    try { await replaceProgramExercises(selected.id, selected.workout_exercises.filter((line) => line.id !== lineId)); void load(); }
    catch (error) { notify(error instanceof Error ? error.message : "Suppression impossible"); }
  };
  const moveLine = async (index: number, direction: -1 | 1) => {
    if (!selected) return;
    const otherIndex = index + direction;
    if (otherIndex < 0 || otherIndex >= selected.workout_exercises.length)
      return;
    const current = selected.workout_exercises[index];
    const other = selected.workout_exercises[otherIndex];
    const next = [...selected.workout_exercises];
    next[index] = { ...other, position: current.position };
    next[otherIndex] = { ...current, position: other.position };
    await replaceProgramExercises(selected.id, next);
    void load();
  };

  return (
    <div className="page program-editor">
      <button className="text-button back-button" onClick={onBack}>
        <ArrowLeft /> Retour aux programmes
      </button>
      <div className="page-actions">
        <PageTitle
          eyebrow="ÉDITEUR"
          title={title}
          text="Créez les séances et configurez leurs blocs."
        />
      </div>
      <div className="workout-tabs">
        {workouts.map((workout) => (
          <button
            className={selectedWorkoutId === workout.id ? "selected" : ""}
            onClick={() => setSelectedWorkoutId(workout.id)}
            key={workout.id}
          >
            {workout.title}
          </button>
        ))}
        <div className="inline-create">
          <input
            value={newWorkoutTitle}
            onChange={(event) => setNewWorkoutTitle(event.target.value)}
            placeholder="Nouvelle séance"
          />
          <button
            disabled={!newWorkoutTitle.trim() || busy}
            onClick={() => void createWorkout()}
          >
            <Plus />
          </button>
        </div>
      </div>
      {loading ? (
        <div className="data-empty">Chargement de l’éditeur…</div>
      ) : !selected ? (
        <div className="data-empty">
          <Dumbbell />
          <h3>Créez votre première séance</h3>
        </div>
      ) : (
        <div className="editor-grid">
          <section className="detail-card editor-session">
            <div className="section-title">
              <div>
                <span className="eyebrow">SÉANCE</span>
                <h2>{selected.title}</h2>
              </div>
              <span className="count-pill">
                {selected.workout_exercises.length} exercices
              </span>
            </div>
            {selected.workout_exercises.length === 0 ? (
              <p className="muted-copy">
                Ajoutez des exercices depuis le panneau de droite.
              </p>
            ) : (
              selected.workout_exercises.map((line, index) => {
                const block = selected.workout_blocks.find(
                  (item) => item.id === line.block_id,
                );
                return (
                  <div className="editor-exercise-row" key={line.id}>
                    <span>{index + 1}</span>
                    <div>
                      <b>{line.exercises?.name ?? "Exercice"}</b>
                      <small>
                        {line.sets} × {line.reps} · repos {line.rest_seconds}s{" "}
                        {block ? `· ${block.title}` : ""}
                      </small>
                    </div>
                    <button
                      disabled={index === 0}
                      onClick={() => void moveLine(index, -1)}
                    >
                      ↑
                    </button>
                    <button
                      disabled={index === selected.workout_exercises.length - 1}
                      onClick={() => void moveLine(index, 1)}
                    >
                      ↓
                    </button>
                    <button
                      className="row-delete"
                      onClick={() => void removeLine(line.id)}
                    >
                      <Trash2 />
                    </button>
                  </div>
                );
              })
            )}
          </section>
          <aside className="editor-sidebar">
            <section className="detail-card editor-form">
              <h2>Ajouter un exercice</h2>
              <label>
                Nom
                <input
                  value={exerciseName}
                  onChange={(event) => setExerciseName(event.target.value)}
                  placeholder="Développé couché"
                />
              </label>
              <div className="triple-fields">
                <label>
                  Séries
                  <input
                    type="number"
                    min="1"
                    value={sets}
                    onChange={(event) => setSets(Number(event.target.value))}
                  />
                </label>
                <label>
                  Répétitions
                  <input
                    value={reps}
                    onChange={(event) => setReps(event.target.value)}
                  />
                </label>
                <label>
                  Repos (s)
                  <input
                    type="number"
                    min="0"
                    value={restSeconds}
                    onChange={(event) =>
                      setRestSeconds(Number(event.target.value))
                    }
                  />
                </label>
              </div>
              <label>
                Bloc
                <select
                  value={blockId}
                  onChange={(event) => setBlockId(event.target.value)}
                >
                  <option value="">Aucun bloc</option>
                  {selected.workout_blocks.map((block) => (
                    <option value={block.id} key={block.id}>
                      {block.title}
                    </option>
                  ))}
                </select>
              </label>
              <button
                className="primary"
                disabled={!exerciseName.trim() || busy}
                onClick={() => void addExercise()}
              >
                <Plus /> Ajouter
              </button>
            </section>
            <section className="detail-card editor-form">
              <h2>Créer un bloc</h2>
              <label>
                Type
                <select
                  value={blockType}
                  onChange={(event) => {
                    const type = event.target.value as TimerMode;
                    setBlockType(type);
                    setBlockTitle(type);
                    const preset = timerPresets[type];
                    setBlockWork(preset.work);
                    setBlockRest(preset.rest);
                    setBlockRounds(preset.rounds);
                  }}
                >
                  {(Object.keys(timerPresets) as TimerMode[]).map((type) => (
                    <option key={type}>{type}</option>
                  ))}
                </select>
              </label>
              <label>
                Nom
                <input
                  value={blockTitle}
                  onChange={(event) => setBlockTitle(event.target.value)}
                />
              </label>
              <div className="triple-fields">
                <label>
                  Travail
                  <input
                    type="number"
                    min="1"
                    value={blockWork}
                    onChange={(event) =>
                      setBlockWork(Number(event.target.value))
                    }
                  />
                </label>
                <label>
                  Repos
                  <input
                    type="number"
                    min="0"
                    value={blockRest}
                    onChange={(event) =>
                      setBlockRest(Number(event.target.value))
                    }
                  />
                </label>
                <label>
                  Tours
                  <input
                    type="number"
                    min="1"
                    value={blockRounds}
                    onChange={(event) =>
                      setBlockRounds(Number(event.target.value))
                    }
                  />
                </label>
              </div>
              <button
                className="secondary"
                disabled={busy}
                onClick={() => void addBlock()}
              >
                <TimerReset /> Ajouter le bloc
              </button>
            </section>
          </aside>
        </div>
      )}
    </div>
  );
}

function ProgramsLive({
  notify,
  onImport,
  onOpen,
}: {
  notify: (s: string) => void;
  onImport: () => void;
  onOpen: (id: string) => void;
}) {
  const [items, setItems] = useState<ProgramRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const { clients: coachClients } = useCoachClients();
  const load = async () => {
    setLoading(true);
    try { setItems(await loadPrograms() as ProgramRecord[]); setError(""); }
    catch (error) { setError(error instanceof Error ? error.message : "Chargement impossible"); }
    setLoading(false);
  };
  useEffect(() => {
    void load();
  }, []);
  const create = async () => {
    const title = window
      .prompt("Nom du nouveau programme", "Nouveau programme")
      ?.trim();
    if (!title) return;
    try { await createProgram(title); }
    catch (error) { setError(error instanceof Error ? error.message : "Création impossible"); return; }
    notify("Programme créé dans Firebase");
    void load();
  };
  return (
    <div className="page">
      <div className="page-actions">
        <PageTitle
          eyebrow="BIBLIOTHÈQUE"
          title="Programmes"
          text="Créez une fois, adaptez rapidement et attribuez à vos clients."
        />
        <button className="primary" onClick={create}>
          <Plus />
          Nouveau programme
        </button>
      </div>
      <div className="import-banner">
        <span>
          <Sparkles />
        </span>
        <div>
          <b>Importer un programme</b>
          <p>
            Collez du texte ou déposez un PDF pour créer une séance structurée.
          </p>
        </div>
        <button className="secondary" onClick={onImport}>
          Importer
        </button>
      </div>
      {error && (
        <div className="data-error">
          <CircleAlert />
          {error}
        </div>
      )}
      {loading ? (
        <div className="data-empty">Chargement des programmes…</div>
      ) : items.length === 0 ? (
        <div className="data-empty">
          <Dumbbell />
          <h3>Aucun programme pour le moment</h3>
          <p>
            Créez votre premier programme pour commencer à organiser les
            séances.
          </p>
          <button className="primary" onClick={create}>
            <Plus />
            Créer un programme
          </button>
        </div>
      ) : (
        <div className="program-grid">
          {items.map((p) => (
            <article key={p.id}>
              <span className="program-icon">
                <Dumbbell />
              </span>
              <small>PROGRAMME SUPABASE</small>
              <h3>{p.title}</h3>
              <p>{p.description || "Prêt à recevoir ses premières séances."}</p>
              <div className="program-tags">
                <span>
                  {p.duration_weeks || 1} semaine
                  {(p.duration_weeks || 1) > 1 ? "s" : ""}
                </span>
                <span>
                  {p.workouts?.length ?? 0} séance
                  {(p.workouts?.length ?? 0) > 1 ? "s" : ""}
                </span>
                <span>
                  {p.program_assignments?.length ?? 0} client
                  {(p.program_assignments?.length ?? 0) > 1 ? "s" : ""}
                </span>
              </div>
              <button className="secondary" onClick={() => onOpen(p.id)}>
                Ouvrir l’éditeur
                <ChevronRight />
              </button>
              <AssignProgramButton
                program={p}
                clients={coachClients}
                onAssigned={() => {
                  notify(`Programme attribué avec succès`);
                  void load();
                }}
              />
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
function Programs({ notify }: { notify: (s: string) => void }) {
  return (
    <div className="page">
      <div className="page-actions">
        <PageTitle
          eyebrow="BIBLIOTHÈQUE"
          title="Programmes"
          text="Créez une fois, adaptez rapidement et attribuez à vos clients."
        />
        <button
          className="primary"
          onClick={() => notify("Créateur de programme prêt")}
        >
          <Plus />
          Nouveau programme
        </button>
      </div>
      <div className="import-banner">
        <span>
          <Sparkles />
        </span>
        <div>
          <b>Importer un programme</b>
          <p>
            Collez du texte ou déposez un PDF. L’import intelligent sera ajouté
            à la prochaine étape.
          </p>
        </div>
        <button
          className="secondary"
          onClick={() => notify("Import bientôt disponible")}
        >
          Importer
        </button>
      </div>
      <div className="program-grid">
        {["Force — 3 jours", "Remise en forme", "Hypertrophie — 4 jours"].map(
          (p, i) => (
            <article key={p}>
              <span className="program-icon">
                <Dumbbell />
              </span>
              <small>PROGRAMME</small>
              <h3>{p}</h3>
              <p>
                {i + 3} séances · {i + 5} clients actifs
              </p>
              <div className="program-tags">
                <span>{i === 1 ? "Débutant" : "Intermédiaire"}</span>
                <span>8 semaines</span>
              </div>
              <button
                className="secondary"
                onClick={() => notify(`${p} sélectionné`)}
              >
                Ouvrir
                <ChevronRight />
              </button>
            </article>
          ),
        )}
      </div>
    </div>
  );
}
function Profile({
  role,
  displayName,
  email,
  demoMode,
  onRole,
  onSignOut,
}: {
  role: Role;
  displayName: string;
  email: string;
  demoMode: boolean;
  onRole: () => void;
  onSignOut: () => void;
}) {
  const isCoach = role === "coach";
  const [name, setName] = useState(displayName);
  const [nextEmail, setNextEmail] = useState(email);
  const [password, setPassword] = useState("");
  const [avatarUrl, setAvatarUrl] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteText, setDeleteText] = useState("");
  const [deleting, setDeleting] = useState(false);
  useEffect(() => {
    setName(displayName);
    setNextEmail(email);
    const user = firebaseAuth.currentUser;
    if (!user || demoMode) return;
    getDoc(doc(firestore, "profiles", user.uid)).then((profile) => setAvatarUrl(profile.data()?.avatar_url ?? ""));
  }, [displayName, email, demoMode]);
  const initials = name
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  const saveProfile = async (event: React.FormEvent) => {
    event.preventDefault();
    if (demoMode || !name.trim()) return;
    if (password && password.length < 6) {
      setMessage("Le mot de passe doit contenir au moins 6 caractères.");
      return;
    }
    setSaving(true);
    setMessage("");
    const user = firebaseAuth.currentUser;
    if (!user) {
      setSaving(false);
      setMessage("Votre session a expiré.");
      return;
    }
    const emailChanged = nextEmail.trim() && nextEmail.trim() !== email;
    try {
      await setDoc(doc(firestore, "profiles", user.uid), { display_name: name.trim(), avatar_url: avatarUrl.trim() || null }, { merge: true });
      await updateProfile(user, { displayName: name.trim(), photoURL: avatarUrl.trim() || null });
      if (emailChanged) await updateEmail(user, nextEmail.trim());
      if (password) await updatePassword(user, password);
    } catch (error) { setSaving(false); setMessage(error instanceof Error ? error.message : "Modification impossible."); return; }
    setSaving(false);
    setPassword("");
    setMessage(
      emailChanged
        ? "Profil enregistré. Confirmez le nouvel e-mail depuis votre boîte de réception."
        : "Profil enregistré.",
    );
  };
  const deleteAccount = async () => {
    if (deleteText !== "SUPPRIMER") return;
    setDeleting(true);
    try {
      const removeAccount = httpsCallable(firebaseFunctions, "deleteAccount");
      await removeAccount({});
    } catch {
      setDeleting(false);
      setMessage("Suppression impossible. Vérifiez que la fonction Firebase deleteAccount est déployée.");
      return;
    }
    setDeleteOpen(false);
    onSignOut();
  };
  return (
    <div className="page">
      <PageTitle
        eyebrow="COMPTE"
        title="Votre profil"
        text="Préférences et connexion à votre accompagnement."
      />
      <section className="settings-card">
        <div className="profile-line">
          {avatarUrl ? (
            <img className="profile-avatar-image" src={avatarUrl} alt="" />
          ) : (
            <span className="avatar large">{initials}</span>
          )}
          <div>
            <b>{displayName}</b>
            <small>
              {isCoach
                ? "Compte coach"
                : role === "client"
                  ? "Compte membre accompagné"
                  : "Entraînement autonome"}
            </small>
          </div>
        </div>
        <button disabled title="Les notifications seront connectées ensuite">
          <Bell />
          Notifications à venir
          <ChevronRight />
        </button>
        <button disabled title="Les préférences seront connectées ensuite">
          <Settings />
          Préférences à venir
          <ChevronRight />
        </button>
        {demoMode && (
          <button onClick={onRole}>
            <UserRound />
            Changer de mode de démonstration
            <ChevronRight />
          </button>
        )}
        <button className="logout-row" onClick={onSignOut}>
          <LogOut />
          {demoMode ? "Quitter la démonstration" : "Se déconnecter"}
          <ChevronRight />
        </button>
      </section>
      {!demoMode && (
        <section className="profile-edit-card">
          <h2>Informations du compte</h2>
          <form onSubmit={saveProfile}>
            <label>
              Nom affiché
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                required
              />
            </label>
            <label>
              Adresse e-mail
              <input
                type="email"
                value={nextEmail}
                onChange={(event) => setNextEmail(event.target.value)}
                required
              />
            </label>
            <label>
              Photo de profil — URL
              <input
                type="url"
                value={avatarUrl}
                onChange={(event) => setAvatarUrl(event.target.value)}
                placeholder="https://…"
              />
            </label>
            <label>
              Nouveau mot de passe
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="Laisser vide pour ne pas le changer"
                minLength={6}
              />
            </label>
            {message && <div className="profile-message">{message}</div>}
            <button className="primary" disabled={saving || !name.trim()}>
              {saving ? "Enregistrement…" : "Enregistrer les modifications"}
            </button>
          </form>
        </section>
      )}
      {!demoMode && (
        <section className="danger-zone">
          <div>
            <h2>Supprimer mon compte</h2>
            <p>Cette action efface définitivement le compte et ses données.</p>
          </div>
          <button
            className="danger-outline"
            onClick={() => setDeleteOpen(true)}
          >
            Supprimer mon compte
          </button>
        </section>
      )}
      <AlertDialog.Root open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialog.Portal>
          <AlertDialog.Overlay className="modal-backdrop" />
          <AlertDialog.Content className="confirm-dialog account-delete-dialog">
            <AlertDialog.Title>
              Supprimer définitivement le compte ?
            </AlertDialog.Title>
            <AlertDialog.Description>
              Programmes, séances, historiques et relations seront supprimés.
              Cette action est irréversible.
            </AlertDialog.Description>
            <label>
              Saisissez SUPPRIMER
              <input
                value={deleteText}
                onChange={(event) => setDeleteText(event.target.value)}
                autoComplete="off"
              />
            </label>
            <div className="modal-actions">
              <AlertDialog.Cancel asChild>
                <button className="secondary">Annuler</button>
              </AlertDialog.Cancel>
              <button
                className="danger-button"
                disabled={deleteText !== "SUPPRIMER" || deleting}
                onClick={() => void deleteAccount()}
              >
                {deleting ? "Suppression…" : "Supprimer définitivement"}
              </button>
            </div>
          </AlertDialog.Content>
        </AlertDialog.Portal>
      </AlertDialog.Root>
    </div>
  );
}

function PageTitle({
  eyebrow,
  title,
  text,
}: {
  eyebrow: string;
  title: string;
  text: string;
}) {
  return (
    <div className="page-title">
      <span className="eyebrow">{eyebrow}</span>
      <h1>{title}</h1>
      <p>{text}</p>
    </div>
  );
}
function Stat({
  label,
  value,
  note,
}: {
  label: string;
  value: string;
  note: string;
}) {
  return (
    <div className="stat">
      <small>{label}</small>
      <b>{value}</b>
      <span>{note}</span>
    </div>
  );
}
function MobileNav({
  screen,
  setScreen,
}: {
  screen: Screen;
  setScreen: (s: Screen) => void;
}) {
  return (
    <nav className="mobile-nav">
      <Nav
        active={screen === "home"}
        icon={<Home />}
        label="Accueil"
        onClick={() => setScreen("home")}
      />
      <Nav
        active={screen === "sessions" || screen === "workout"}
        icon={<Dumbbell />}
        label="Séances"
        onClick={() => setScreen("sessions")}
      />
      <Nav
        active={screen === "progress"}
        icon={<BarChart3 />}
        label="Progrès"
        onClick={() => setScreen("progress")}
      />
      <Nav
        active={screen === "tools"}
        icon={<TimerReset />}
        label="Outils"
        onClick={() => setScreen("tools")}
      />
      <Nav
        active={screen === "profile"}
        icon={<UserRound />}
        label="Profil"
        onClick={() => setScreen("profile")}
      />
    </nav>
  );
}

export default App;
