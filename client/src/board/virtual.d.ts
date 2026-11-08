/**
 * 'virtual:sauda-board' is resolved by the board plugin in vite.config.ts: to BryntumBoard.tsx when
 * node_modules/@bryntum/gantt is installed, and to FallbackBoard.tsx otherwise. Both export Board.
 */
declare module 'virtual:sauda-board' {
  export const Board: (props: import('./props.js').BoardProps) => import('react').ReactNode;
}
