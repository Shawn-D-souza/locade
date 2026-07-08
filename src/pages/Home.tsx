import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useUser } from '../platform/store/useUserStore';

export default function Home() {
  const { userName, setUserName } = useUser();
  const [isEditing, setIsEditing] = useState(false);
  const [inputValue, setInputValue] = useState(userName);
  const [joinId, setJoinId] = useState('');
  const navigate = useNavigate();

  const handleSave = () => {
    if (inputValue.trim()) setUserName(inputValue.trim());
    setIsEditing(false);
  };

  const handleCreateLobby = () => {
    const newLobbyId = Math.random().toString(36).substring(2, 8).toUpperCase();
    navigate(`/lobby/${newLobbyId}`, { state: { isHost: true } });
  };

  const handleJoinLobby = () => {
    if (joinId.trim()) {
      navigate(`/lobby/${joinId.trim().toUpperCase()}`, { state: { isHost: false } });
    }
  };

  return (
    <div className="p-4">
      <h1>Locade - Home</h1>
      <div className="my-4">
        {isEditing ? (
          <div>
            <input 
              type="text" 
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSave()}
            />
            <button onClick={() => setIsEditing(false)}>Cancel</button>
            <button onClick={handleSave}>Save</button>
          </div>
        ) : (
          <div>
            <span>{userName}</span>
            <button onClick={() => { setInputValue(userName); setIsEditing(true); }}>
              Edit Name
            </button>
          </div>
        )}
      </div>

      <div className="my-4">
        <button onClick={handleCreateLobby}>
          Start a Lobby
        </button>
      </div>

      <div className="my-4">
        <input 
          type="text" 
          placeholder="Lobby Code"
          value={joinId}
          onChange={(e) => setJoinId(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleJoinLobby()}
        />
        <button onClick={handleJoinLobby}>
          Join Lobby
        </button>
      </div>
    </div>
  );
}
