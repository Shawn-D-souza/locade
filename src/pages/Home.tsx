import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useUser } from '../platform/store/useUserStore';

export default function Home() {
  const { userName, setUserName } = useUser();
  const [isEditing, setIsEditing] = useState(false);
  const [inputValue, setInputValue] = useState(userName);
  const navigate = useNavigate();

  const handleSave = () => {
    if (inputValue.trim()) setUserName(inputValue.trim());
    setIsEditing(false);
  };

  const handleCreateParty = () => {
    // TODO: Replace with actual WebRTC room/party generating the code
    const mockPartyId = Math.random().toString(36).substring(2, 8).toUpperCase();
    navigate(`/party/${mockPartyId}`);
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

      <button onClick={handleCreateParty}>
        Start a Party
      </button>
    </div>
  );
}
