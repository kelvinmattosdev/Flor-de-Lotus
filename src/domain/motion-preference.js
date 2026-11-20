export const MOTION_KEY = 'flor-de-lotus:motion:v1';
export const motionChoice = value => ['auto','full','reduced'].includes(value) ? value : 'auto';
export const effectiveMotion = (choice, systemReduced) => motionChoice(choice)==='full' || (motionChoice(choice)==='auto'&&!systemReduced) ? 'full' : 'reduced';
