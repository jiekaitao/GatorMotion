const TEMPLATES = [
  (first: string, exercise: string) =>
    `Hey ${first}, let's crush those ${exercise} today! You've got this.`,
  (first: string, exercise: string) =>
    `Alright ${first}, time for some ${exercise}. Let's make every rep count!`,
  (first: string, exercise: string) =>
    `Welcome back ${first}! Ready to knock out some ${exercise}? Let's do it.`,
  (first: string, exercise: string) =>
    `Hey ${first}! ${exercise} time. Stay focused and keep that form tight.`,
  (first: string, exercise: string) =>
    `Let's go ${first}! Today's ${exercise} session is going to be awesome.`,
  (first: string, exercise: string) =>
    `Good to see you ${first}! Let's get started with ${exercise}. Nice and steady.`,
];

export function generateIntroMessage(fullName: string, exerciseName: string): string {
  const firstName = fullName.split(" ")[0];
  const template = TEMPLATES[Math.floor(Math.random() * TEMPLATES.length)];
  return template(firstName, exerciseName);
}
