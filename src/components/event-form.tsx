import { EVENT_CHAINS, type Event } from "@/lib/domain/events";

const local = (d?: Date) => (d ? d.toISOString().slice(0, 16) : undefined);

/** Fields shared by the create and edit event forms. Times are UTC. */
export function EventFields({ event }: { event?: Event }) {
  return (
    <>
      <label>Name<input name="name" required defaultValue={event?.name} /></label>
      <label>Description<textarea name="description" defaultValue={event?.description} /></label>
      <div className="grid">
        <label>Starts (UTC)<input name="startsAt" type="datetime-local" required defaultValue={local(event?.startsAt)} /></label>
        <label>Ends (UTC)<input name="endsAt" type="datetime-local" required defaultValue={local(event?.endsAt)} /></label>
        <label>Submission deadline (UTC)<input name="submissionDeadline" type="datetime-local" required defaultValue={local(event?.submissionDeadline)} /></label>
      </div>
      <div className="grid">
        <label>Max team members<input name="maxTeamSize" type="number" min={1} max={50} defaultValue={event?.maxTeamSize ?? 5} /></label>
        <label>
          Chain / ecosystem
          <select name="chain" defaultValue={event?.chain ?? "solana"}>
            {EVENT_CHAINS.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
      </div>
      <label>Website (optional)<input name="websiteUrl" type="url" defaultValue={event?.websiteUrl ?? ""} placeholder="https://" /></label>
      <label>
        Prizes, one per line as &quot;Title | reward&quot;
        <textarea
          name="prizes"
          placeholder={"Grand prize | $5,000\nBest design | $1,000"}
          defaultValue={event?.prizes.map((p) => (p.reward ? `${p.title} | ${p.reward}` : p.title)).join("\n")}
        />
      </label>
    </>
  );
}
