import { useParams } from 'react-router-dom';
import { useUser } from '../platform/store/useUserStore';

export default function Party() {
  // Extract the party ID from the URL (e.g., /party/123456 -> partyId = 123456)
  const { partyId } = useParams<{ partyId: string }>();
  const { userName } = useUser();

  return (
    <div className="p-4">
      <h1>Party Lobby</h1>
      <p>Room Code: <strong>{partyId}</strong></p>
      <p>You are connected as: {userName}</p>
    </div>
  );
}
