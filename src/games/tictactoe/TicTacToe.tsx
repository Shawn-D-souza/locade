import type { GameProps } from '../GameProps';
import type { TicTacToeData } from './types';

export default function TicTacToe(props: GameProps<TicTacToeData>) {
  return (
    <div className="flex flex-col items-center justify-center min-h-[100dvh] p-4">
      <h1 className="text-4xl font-bold mb-8">TicTacToe</h1>
      
      <div className="grid grid-cols-3 gap-2">
        {Array.from({ length: 9 }).map((_, index) => (
          <button
            key={index}
            className="w-24 h-24 border-2 border-black flex items-center justify-center text-4xl cursor-pointer hover:bg-gray-100"
            aria-label={`Cell ${index}`}
          >
            {/* Empty for now */}
          </button>
        ))}
      </div>
    </div>
  );
}
