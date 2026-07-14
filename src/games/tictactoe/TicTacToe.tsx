import type { GameProps } from '../GameProps';
import type { TicTacToeData } from './types';

export default function TicTacToe(props: GameProps<TicTacToeData>) {
  return (
    <div className="flex flex-col items-center justify-center min-h-[100dvh]">
      <h1 className="text-4xl font-bold">TicTacToe</h1>
    </div>
  );
}
