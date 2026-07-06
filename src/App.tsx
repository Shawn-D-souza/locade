import { useState } from 'react';
import { useUser } from './platform/store/useUserStore';
import './App.css';

function App() {
  const { userName, setUserName } = useUser();
  const [isEditing, setIsEditing] = useState(false);
  const [inputValue, setInputValue] = useState(userName);

  const handleEdit = () => {
    setInputValue(userName);
    setIsEditing(true);
  };

  const handleSave = () => {
    if (inputValue.trim()) {
      setUserName(inputValue.trim());
    }
    setIsEditing(false);
  };

  const handleCancel = () => {
    setIsEditing(false);
  };

  return (
    <div>
      <h1>Locade</h1>
      {isEditing ? (
        <div>
          <input 
            type="text" 
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSave()}
          />
          <div>
            <button onClick={handleCancel}>
              Cancel
            </button>
            <button onClick={handleSave}>
              Save
            </button>
          </div>
        </div>
      ) : (
        <div>
          <div>{userName}</div>
          <button onClick={handleEdit}>
            Edit Name
          </button>
        </div>
      )}
    </div>
  );
}

export default App;
