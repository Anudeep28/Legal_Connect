import { useEffect, useRef, useState } from 'react';
import {
  useGetConsultationCall, useJoinConsultationCall, useSetCallRecordingConsent,
  useUpdateCallRecordingLanguage,
  getGetConsultationCallQueryKey, type Consultation,
} from '@workspace/api-client-react';
import type { Room, RemoteTrack, RemoteParticipant } from 'twilio-video';
import { Button } from '@/components/ui/button';
import { errMsg, fmtDateTime } from '@/lib/format';

function stopRoom(room: Room) {
  room.localParticipant.audioTracks.forEach((publication) => publication.track.stop());
  room.disconnect();
}

export function ConsultationCall({ consultation, asLawyer }: { consultation: Consultation; asLawyer: boolean }) {
  const c = consultation;
  const availability = useGetConsultationCall(c.id, {
    query: { queryKey: getGetConsultationCallQueryKey(c.id), refetchInterval: 5000 },
  });
  const join = useJoinConsultationCall();
  const recordingConsentMutation = useSetCallRecordingConsent();
  const languageMutation = useUpdateCallRecordingLanguage();
  const roomRef = useRef<Room | null>(null);
  const audioRef = useRef<HTMLDivElement>(null);
  const generation = useRef(0);
  const recordingChoiceTouched = useRef(false);
  const [consent, setConsent] = useState(false);
  const [recordingDisclosureAcknowledged, setRecordingDisclosureAcknowledged] = useState(false);
  const [recordingChoice, setRecordingChoice] = useState<'record' | 'unrecorded'>('unrecorded');
  const [recordingLanguageCode, setRecordingLanguageCode] = useState('auto');
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
    setRecordingDisclosureAcknowledged(false);
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
    if (!recordingChoiceTouched.current && availability.data?.myRecordingConsent != null)
      setRecordingChoice(availability.data.myRecordingConsent ? 'record' : 'unrecorded');
  }, [availability.data?.myRecordingConsent]);
  useEffect(() => {
    setRecordingLanguageCode(availability.data?.recordingLanguageCode ?? 'auto');
  }, [availability.data?.recordingLanguageCode]);
  useEffect(() => {
    const time = Math.max(0, new Date(c.endsAt).getTime() - Date.now());
    if (time > 2_147_483_647) return;
    const timer = setTimeout(() => { if (roomRef.current) leave(); }, time);
    return () => clearTimeout(timer);
  }, [c.endsAt]);

  const start = async () => {
    if (!consent || !recordingDisclosureAcknowledged || busy || connected) return;
    const attempt = ++generation.current;
    setError(''); setBusy(true); setState('Requesting call access…');
    let createdRoom: Room | null = null;
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('This browser does not support secure microphone access.');
      if (availability.data?.recordingConsentEnabled) {
        const choice = await recordingConsentMutation.mutateAsync({
          id: c.id, data: { consent: recordingChoice === 'record' },
        });
        await availability.refetch();
        if (recordingChoice === 'record' && choice.mode === 'pending' && choice.otherConsent !== true) {
          setState('Your choice is saved. Waiting for the other participant; choose unrecorded to join now.');
          return;
        }
        if (recordingChoice === 'record' && choice.mode === 'unrecorded') {
          setRecordingChoice('unrecorded');
          setState('This consultation will continue unrecorded. Choose Join unrecorded to continue.');
          return;
        }
      }
      const access = await join.mutateAsync({ id: c.id, data: { microphoneConsent: true, recordingDisclosureAcknowledged: true } });
      if (attempt !== generation.current) return;
      const { connect } = await import('twilio-video');
      if (attempt !== generation.current) return;
      setState('Connecting to Twilio…');
      const room = await connect(access.token, { name: access.room, audio: true, video: false });
      createdRoom = room;
      if (attempt !== generation.current) { stopRoom(room); return; }
      if (room.isRecording !== access.recordingEnabled) {
        stopRoom(room);
        if (room.isRecording && !access.recordingEnabled)
          await recordingConsentMutation.mutateAsync({ id: c.id, data: { consent: false, stopCall: true } });
        throw new Error('The provider recording status did not match the saved consent. The call was disconnected.');
      }
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
        if (access.recordingEnabled) {
          setState('Recording is active with both participants’ consent.');
          return;
        }
        setError('Unexpected recording was detected. The call is being stopped.');
        void recordingConsentMutation.mutateAsync({ id: c.id, data: { consent: false, stopCall: true } })
          .catch(() => setError('Unexpected recording was detected. The provider is retrying room closure.'));
        leave();
      });
      room.on('disconnected', (_room, failure) => {
        room.localParticipant.audioTracks.forEach((p) => p.track.stop());
        if (roomRef.current === room) {
          roomRef.current = null;
          audioRef.current?.replaceChildren();
          setConnected(false); setMuted(false); setConsent(false); setRecordingDisclosureAcknowledged(false);
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
  const stopRecording = async () => {
    setBusy(true);
    let message = 'Recording consent withdrawn. The call was ended and future joins will be unrecorded.';
    try {
      await recordingConsentMutation.mutateAsync({ id: c.id, data: { consent: false } });
    } catch (e) {
      message = `The call was disconnected, but room closure is still being retried: ${errMsg(e)}`;
    } finally {
      leave();
      setError(message);
      await availability.refetch();
    }
  };
  const speaker = async () => {
    try {
      await Promise.all(Array.from(audioRef.current?.querySelectorAll('audio') || []).map((audio) => audio.play()));
      setError('');
    } catch { setError('Audio playback is still blocked. Check browser audio permissions.'); }
  };
  const changeRecordingLanguage = async (languageCode: string) => {
    const previous = recordingLanguageCode;
    setRecordingLanguageCode(languageCode);
    try {
      await languageMutation.mutateAsync({ id: c.id, data: { languageCode } });
      await availability.refetch();
    } catch (e) {
      setRecordingLanguageCode(previous);
      setError(errMsg(e));
    }
  };
  return <section className="mt-6 space-y-4 rounded-3xl border bg-card p-5" data-testid="consultation-call">
    <h2 className="font-display text-xl font-semibold">Private audio consultation</h2>
    <p className="text-sm text-muted-foreground">Only you and the assigned consultation participant can join. Calls open 10 minutes before the appointment and the join window ends at {fmtDateTime(c.endsAt)} IST. If either person disconnects early, the consultation remains booked and both participants can rejoin before that time. Disconnecting does not mark it complete; the assigned lawyer can mark it complete here, which closes call access. {availability.data?.recordingConsentEnabled ? 'Recording is optional and starts only if both participants opt in for this consultation. If either declines or withdraws, the call is stopped and any rejoin is unrecorded.' : 'Recording is disabled; no call audio is saved by this app.'}</p>
    <p role="status" data-testid="call-status">{state}</p>
    {availability.isLoading && <p className="text-sm">Checking call availability…</p>}
    {availability.isError && <p role="alert" className="text-sm text-destructive">{errMsg(availability.error)}</p>}
    {availability.data && !availability.data.canJoin && <p className="text-sm" data-testid="call-unavailable">{availability.data.reason}</p>}
    {availability.data?.recordingConsentEnabled && <>
      <p className="text-sm" data-testid="recording-consent-disclosure">If both participants opt in, Twilio records separate audio tracks for transcription by ElevenLabs after the room ends. The assigned lawyer can correct the private transcript before choosing a template for an AI draft. Twilio audio is deleted after transcription succeeds or after three failed attempts. Nothing is sent to the client until the lawyer reviews and publishes it. If either participant declines or withdraws, the call remains unrecorded from that point.</p>
      {availability.data.recordingMode === 'unrecorded' && <p role="status" className="text-sm" data-testid="recording-locked-off">This consultation is locked to an unrecorded call because a participant declined or withdrew consent.</p>}
      {asLawyer && availability.data.recordingLanguageEditable && (
        <label className="block max-w-sm space-y-1 text-sm">
          <span>Conversation language for transcription</span>
          <select
            value={recordingLanguageCode}
            disabled={languageMutation.isPending}
            onChange={(e) => void changeRecordingLanguage(e.target.value)}
            className="w-full rounded-xl border bg-background px-3 py-2"
            data-testid="select-call-recording-language"
          >
            <option value="auto">Auto-detect</option>
            {availability.data.recordingLanguageOptions.map((language) => (
              <option key={language.code} value={language.code}>{language.nativeName}</option>
            ))}
          </select>
          <span className="block text-xs text-muted-foreground">English and Marathi switches can be included alongside the selected language when supported; review the transcript for errors.</span>
        </label>
      )}
    </>}
    {!connected && <>
      <label className="flex items-start gap-3 text-sm"><input type="checkbox" checked={consent} disabled={busy} onChange={(e) => setConsent(e.target.checked)} data-testid="consent-microphone" />I consent to microphone access and transmission of my audio to the other participant through Twilio for this call.</label>
      {availability.data?.recordingConsentEnabled ? (
        <>
          <label className="flex items-start gap-3 text-sm"><input type="radio" name={`recording-choice-${c.id}`} checked={recordingChoice === 'record'} disabled={busy || availability.data.recordingMode === 'unrecorded'} onChange={() => { recordingChoiceTouched.current = true; setRecordingChoice('record'); }} data-testid="consent-record-call" />I agree to record this consultation for a private transcript that the assigned lawyer may use to prepare a reviewed document draft.</label>
          <label className="flex items-start gap-3 text-sm"><input type="radio" name={`recording-choice-${c.id}`} checked={recordingChoice === 'unrecorded'} disabled={busy} onChange={() => { recordingChoiceTouched.current = true; setRecordingChoice('unrecorded'); }} data-testid="decline-recording" />Join without recording.</label>
          {recordingChoice === 'record' && availability.data.otherRecordingConsent !== true && availability.data.recordingMode === 'pending' && <p className="text-sm text-muted-foreground">Your consent is saved. The other participant must also opt in before a recorded room can be created.</p>}
          <label className="flex items-start gap-3 text-sm"><input type="checkbox" checked={recordingDisclosureAcknowledged} disabled={busy} onChange={(e) => setRecordingDisclosureAcknowledged(e.target.checked)} data-testid="consent-recording-disclosure" />I have read the recording disclosure and understand that choosing “Join without recording” is allowed.</label>
        </>
      ) : (
        <label className="flex items-start gap-3 text-sm"><input type="checkbox" checked={recordingDisclosureAcknowledged} disabled={busy} onChange={(e) => setRecordingDisclosureAcknowledged(e.target.checked)} data-testid="consent-no-recording" />I understand recording is disabled. I will not record the other participant without their explicit consent.</label>
      )}
      <Button onClick={start} disabled={!availability.data?.canJoin || !consent || !recordingDisclosureAcknowledged || busy || (recordingChoice === 'record' && availability.data?.recordingConsentEnabled === true && availability.data.otherRecordingConsent !== true && availability.data.myRecordingConsent === true)} data-testid="button-join-call">{busy ? 'Connecting…' : recordingChoice === 'record' && availability.data?.recordingConsentEnabled ? 'Join recorded call' : 'Join or rejoin unrecorded call'}</Button>
      {busy && <Button variant="outline" className="ml-2" onClick={leave}>Cancel connection</Button>}
    </>}
    {connected && <div className="flex flex-wrap gap-2">
      <Button variant="outline" onClick={() => {
        const next = !muted;
        roomRef.current?.localParticipant.audioTracks.forEach((p) => next ? p.track.disable() : p.track.enable());
        setMuted(next);
      }} data-testid="button-mute-call">{muted ? 'Unmute microphone' : 'Mute microphone'}</Button>
      <Button variant="outline" onClick={speaker}>Enable speaker audio</Button>
      {availability.data?.recordingEnabled && <Button variant="destructive" onClick={stopRecording} disabled={busy} data-testid="button-stop-recording">Withdraw consent and end call</Button>}
      <Button variant="destructive" onClick={leave} data-testid="button-leave-call">Leave call</Button>
    </div>}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    <div ref={audioRef} className="hidden" />
  </section>;
}
