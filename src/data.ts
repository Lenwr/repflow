import type { Client, Workout } from "./types";

export const workout: Workout = {
  id: "w1",
  title: "Haut du corps",
  subtitle: "Force & technique",
  duration: 42,
  status: "next",
  day: "Aujourd’hui",
  exercises: [
    {
      id: "e1",
      name: "Développé couché",
      sets: 4,
      reps: "8",
      load: "60 kg",
      rest: 120,
      muscle: "Pectoraux",
      done: 0,
      imageUrl:
        "https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/exercises/Barbell_Bench_Press_-_Medium_Grip/0.jpg",
      imageUrlEnd:
        "https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/exercises/Barbell_Bench_Press_-_Medium_Grip/1.jpg",
    },
    {
      id: "e2",
      name: "Tirage horizontal",
      sets: 4,
      reps: "10",
      load: "45 kg",
      rest: 90,
      muscle: "Dos",
      done: 0,
      imageUrl:
        "https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/exercises/Seated_Cable_Rows/0.jpg",
      imageUrlEnd:
        "https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/exercises/Seated_Cable_Rows/1.jpg",
    },
    {
      id: "e3",
      name: "Développé épaules",
      sets: 3,
      reps: "10",
      load: "16 kg",
      rest: 90,
      muscle: "Épaules",
      done: 0,
      imageUrl:
        "https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/exercises/Dumbbell_Shoulder_Press/0.jpg",
      imageUrlEnd:
        "https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/exercises/Dumbbell_Shoulder_Press/1.jpg",
    },
    {
      id: "e4",
      name: "Curl incliné",
      sets: 3,
      reps: "12",
      load: "10 kg",
      rest: 60,
      muscle: "Biceps",
      done: 0,
      imageUrl:
        "https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/exercises/Incline_Dumbbell_Curl/0.jpg",
      imageUrlEnd:
        "https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/exercises/Incline_Dumbbell_Curl/1.jpg",
    },
  ],
};

export const history: Workout[] = [
  {
    ...workout,
    id: "h1",
    title: "Bas du corps",
    subtitle: "Volume",
    day: "Lun. 18 août",
    status: "done",
    duration: 51,
  },
  {
    ...workout,
    id: "h2",
    title: "Haut du corps",
    subtitle: "Force",
    day: "Jeu. 14 août",
    status: "done",
    duration: 44,
  },
];

export const clients: Client[] = [
  {
    id: "c1",
    name: "Emma Martin",
    initials: "EM",
    color: "#d9f99d",
    goal: "Renforcement",
    lastActivity: "Aujourd’hui",
    adherence: 92,
    trend: "+7%",
    alert: "Programme terminé",
  },
  {
    id: "c2",
    name: "Lucas Bernard",
    initials: "LB",
    color: "#fed7aa",
    goal: "Prise de masse",
    lastActivity: "Hier",
    adherence: 78,
    trend: "+3%",
    alert: "Douleur épaule signalée",
  },
  {
    id: "c3",
    name: "Sarah Petit",
    initials: "SP",
    color: "#bfdbfe",
    goal: "Remise en forme",
    lastActivity: "Il y a 3 jours",
    adherence: 84,
    trend: "+5%",
  },
  {
    id: "c4",
    name: "Mehdi Amari",
    initials: "MA",
    color: "#e9d5ff",
    goal: "Perte de poids",
    lastActivity: "Il y a 9 jours",
    adherence: 41,
    trend: "-12%",
    alert: "Inactif depuis 9 jours",
  },
];
