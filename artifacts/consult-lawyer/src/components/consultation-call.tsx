import { useEffect, useRef, useState } from 'react';
import {
  useGetConsultationCall, useJoinConsultationCall, getGetConsultationCallQueryKey, type Consultation,
} from '@workspace/api-client-react';
import type { Room, RemoteTrack, RemoteParticipant } from 'twilio-video';
import { Button } from '@/components/ui/button';
import { errMsg, fmtDateTime } from '@/lib/format';

function stopRoom(room: Room) {
  room.localParticipant.audioTracks.forEach((publication) => publication.track.stop());
  room.disconnect();
}

export function ConsultationCall({ consultation }: { consultation: Consultation }) {
  const c = consultation;
  const availability = useGetConsultationCall(c.id, {
    query: { queryKey: getGetConsultationCallQueryKey(c.id), refetchInterval: 5000 },
  });
  const join = useJoinConsultationCall();
  const roomRef = useRef<Room | null>(null);
  const audioRef = useRef<HTMLDivElement>(null);
  const generation = useRef(0);
  const [consent, setConsent] = useState(false);
  const [noRecording, setNoRecording] = useState(false);
  const [state, setState] = useState('Not connected');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [connected, setConnected] = useState(false);
  const [muted, setMuted] = useState(false);
  const leave = () => {
    generation.current++;
    if (roomRef.current) stopRoom(roomRef.current);
    roomRef.current = null;
    audioRef.current?.replaceChildren();
    setConnected(false);
    setBusy(false);
    setMuted(false);
    setConsent(false);
    setNoRecording(false);
    setState('Not connected');
  };
  useEffect(() => () => {
    generation.current++;
    if (roomRef.current) stopRoom(roomRef.current);
  }, []);
  useEffect(() => {
    if (roomRef.current && (availability.isError || (availability.data && !availability.data.canJoin))) leave();
  }, [availability.data?.canJoin, availability.isError]);
  useEffect(() => {
    const time = Math.max(0, new Date(c.endsAt).getTime() - Date.now());
    if (time > 2_147_483_647) return;
    const timer = setTimeout(() => { if (roomRef.current) leave(); }, time);
    return () => clearTimeout(timer);
  }, [c.endsAt]);

  const start = async () => {
    if (!consent || !noRecording || busy || connected) return;
    const attempt = ++generation.current;
    setError(''); setBusy(true); setState('Requesting call access…');
    let createdRoom: Room | null = null;
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('This browser does not support secure microphone access.');
      const access = await join.mutateAsync({ id: c.id, data: { microphoneConsent: true, recordingDisabledAcknowledged: true } });
      if (attempt !== generation.current) return;
      const { connect } = await import('twilio-video');
      if (attempt !== generation.current) return;
      setState('Connecting to Twilio…');
      const room = await connect(access.token, { name: access.room, audio: true, video: false });
      createdRoom = room;
      if (attempt !== generation.current) { stopRoom(room); return; }
      if (room.isRecording) { stopRoom(room); throw new Error('The provider reports recording is active. The call was disconnected.'); }
      roomRef.current = room;
      const attach = (track: RemoteTrack) => {
        if (track.kind !== 'audio') return;
        const audio = track.attach();
        audioRef.current?.appendChild(audio);
        void audio.play().catch(() => setError('Audio playback was blocked. Tap Enable speaker audio.'));
      };
      const attachParticipant = (participant: RemoteParticipant) => {
        participant.tracks.forEach((p) => { if (p.isSubscribed && p.track) attach(p.track); });
      };
      room.participants.forEach(attachParticipant);
      room.on('trackSubscribed', attach);
      room.on('trackUnsubscribed', (track) => {
        if (track.kind === 'audio') track.detach().forEach((element) => element.remove());
      });
      room.on('participantConnected', () => setState('Connected — both participants have joined'));
      room.on('participantDisconnected', () => setState('Connected — waiting for the other participant'));
      room.on('reconnecting', () => setState('Connection interrupted — reconnecting…'));
      room.on('reconnected', () => setState(room.participants.size ? 'Connected — both participants have joined' : 'Connected — waiting for the other participant'));
      room.on('recordingStarted', () => {
        setError('Recording was enabled at the provider. The call has been disconnected.');
        leave();
      });
      room.on('disconnected', (_room, failure) => {
        room.localParticipant.audioTracks.forEach((p) => p.track.stop());
        if (roomRef.current === room) {
          roomRef.current = null;
          audioRef.current?.replaceChildren();
          setConnected(false); setMuted(false); setConsent(false); setNoRecording(false);
          setState('Disconnected');
          if (failure) setError('The call disconnected. Check your connection and join again.');
        }
      });
      setConnected(true);
      setState(room.participants.size ? 'Connected — both participants have joined' : 'Connected — waiting for the other participant');
    } catch (e) {
      if (createdRoom) stopRoom(createdRoom);
      if (attempt === generation.current) { setError(errMsg(e)); setState('Not connected'); }
    } finally { if (attempt === generation.current) setBusy(false); }
  };
  const speaker = async () => {
    try {
      await Promise.all(Array.from(audioRef.current?.querySelectorAll('audio') || []).map((audio) => audio.play()));
      setError('');
    } catch { setError('Audio playback is still blocked. Check browser audio permissions.'); }
  };
  return <section className="mt-6 space-y-4 rounded-3xl border bg-card p-5" data-testid="consultation-call">
    <h2 className="font-display text-xl font-semibold">Private audio consultation</h2>
    <p className="text-sm text-muted-foreground">Only you and the assigned consultation participant can join. Calls open 10 minutes before the appointment and end at {fmtDateTime(c.endsAt)} IST. Recording is disabled; no call audio is saved by this app.</p>
    <p role="status" data-testid="call-status">{state}</p>
    {availability.isLoading && <p className="text-sm">Checking call availability…</p>}
    {availability.isError && <p role="alert" className="text-sm text-destructive">{errMsg(availability.error)}</p>}
    {availability.data && !availability.data.canJoin && <p className="text-sm" data-testid="call-unavailable">{availability.data.reason}</p>}
    {!connected && <>
      <label className="flex items-start gap-3 text-sm"><input type="checkbox" checked={consent} disabled={busy} onChange={(e) => setConsent(e.target.checked)} data-testid="consent-microphone" />I consent to microphone access and transmission of my audio to the other participant through Twilio for this call.</label>
      <label className="flex items-start gap-3 text-sm"><input type="checkbox" checked={noRecording} disabled={busy} onChange={(e) => setNoRecording(e.target.checked)} data-testid="consent-no-recording" />I understand recording is disabled. I will not record the other participant without their explicit consent.</label>
      <Button onClick={start} disabled={!availability.data?.canJoin || !consent || !noRecording || busy} data-testid="button-join-call">{busy ? 'Connecting…' : 'Join audio call'}</Button>
      {busy && <Button variant="outline" className="ml-2" onClick={leave}>Cancel connection</Button>}
    </>}
    {connected && <div className="flex flex-wrap gap-2">
      <Button variant="outline" onClick={() => {
        const next = !muted;
        roomRef.current?.localParticipant.audioTracks.forEach((p) => next ? p.track.disable() : p.track.enable());
        setMuted(next);
      }} data-testid="button-mute-call">{muted ? 'Unmute microphone' : 'Mute microphone'}</Button>
      <Button variant="outline" onClick={speaker}>Enable speaker audio</Button>
      <Button variant="destructive" onClick={leave} data-testid="button-leave-call">Leave call</Button>
    </div>}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    <div ref={audioRef} className="hidden" />
  </section>;
}
