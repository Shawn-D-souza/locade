import { useState } from 'react';
import type { GameProps } from '../GameProps';
import type { TicTacToeData, PlayerMark } from './types';

// Helper function to check for a winner
function calculateWinner(squares: (PlayerMark | null)[]): PlayerMark | null {
  const lines = [
    [0, 1, 2], [3, 4, 5], [6, 7, 8], // Rows
    [0, 3, 6], [1, 4, 7], [2, 5, 8], // Cols
    [0, 4, 8], [2, 4, 6]             // Diagonals
  ];
  for (let i = 0; i < lines.length; i++) {
    const [a, b, c] = lines[i];
    if (squares[a] && squares[a] === squares[b] && squares[a] === squares[c]) {
      return squares[a];
    }
  }
  return null;
}

export default function TicTacToe(props: GameProps<TicTacToeData>) {
  const [board, setBoard] = useState<(PlayerMark | null)[]>(Array(9).fill(null));
  const [xIsNext, setXIsNext] = useState<boolean>(true);

  const winner = calculateWinner(board);
  const isDraw = !winner && board.every((square) => square !== null);

  const handleClick = (index: number) => {
    if (board[index] || winner) return;

    const newBoard = [...board];
    newBoard[index] = xIsNext ? 'X' : 'O';
    setBoard(newBoard);
    setXIsNext(!xIsNext);
  };

  const status = winner 
    ? `Winner: ${winner}` 
    : isDraw 
      ? 'Draw!' 
      : `Next player: ${xIsNext ? 'X' : 'O'}`;

  return (
    <div className="flex flex-col items-center justify-center min-h-[100dvh] p-4">
      <h1 className="text-4xl font-bold mb-4">TicTacToe</h1>
      
      <div className="mb-4 text-xl font-semibold">
        {status}
      </div>
      
      <div className="grid grid-cols-3 gap-2">
        {board.map((cell, index) => (
          <button
            key={index}
            onClick={() => handleClick(index)}
            className="w-24 h-24 border-2 border-black flex items-center justify-center text-4xl cursor-pointer hover:bg-gray-100 disabled:bg-gray-50 disabled:cursor-not-allowed"
            aria-label={`Cell ${index}`}
            disabled={!!cell || !!winner}
          >
            {cell}
          </button>
        ))}
      </div>

      {(winner || isDraw) && (
        <button 
          onClick={() => { setBoard(Array(9).fill(null)); setXIsNext(true); }}
          className="mt-6 px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
        >
          Restart Local Game
        </button>
      )}
    </div>
  );
}
