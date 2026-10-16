import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../src/app.js";
import { createTestDb } from "../src/db/connection.js";
import { makeUser } from "./helpers.js";
let db, server, base, repos;
const cookies = {},
  users = {};
async function api(path, user, method = "GET", body) {
  const res = await fetch(base + path, {
    method,
    headers: {
      "content-type": "application/json",
      ...(cookies[user] ? { cookie: cookies[user] } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return {
    status: res.status,
    body: res.headers.get("content-type")?.includes("json")
      ? await res.json()
      : null,
    cookie: res.headers.get("set-cookie")?.split(";")[0],
  };
}
const answers = {
  about: ["supper", "singalong"],
  wants: ["post concert food"],
  avoid: [],
};
before(async () => {
  db = createTestDb();
  const app = createApp({ db });
  repos = app.repos;
  server = app.app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${server.address().port}/api`;
  for (const name of ["host", "friend", "seeker", "outsider"]) {
    const r = await api("/auth/register", null, "POST", {
      display_name: name,
      email: `${name}@api.test`,
      password: "test-password",
      age_band: "21-24",
      home_region: "central",
      gender: "f",
      vibe: makeUser(name).vibe,
    });
    assert.equal(r.status, 201);
    cookies[name] = r.cookie;
    users[name] = r.body.user.id;
  }
  repos.concerts.create({
    id: "c",
    artist: "API Act",
    venue: "Venue",
    city: "Singapore",
    event_date: "2030-12-01",
  });
});
after(async () => {
  await new Promise((r) => server.close(r));
  db.close();
});
let party, invite, join, meetup;
test("community APIs reject unauthenticated users and ownership forgery", async () => {
  assert.equal((await api("/me/notifications")).status, 401);
  assert.equal((await api("/meetups", null, "POST", {})).status, 401);
  const p = await api("/concerts/c/parties", "host", "POST", {
    capacity: 2,
    section: "pit",
    spend_band: 2,
    arrival_plan: "mid",
  });
  assert.equal(p.status, 201);
  party = p.body.party.id;
  assert.equal(
    (
      await api(`/groups/${party}/settings`, "outsider", "PUT", {
        expectedFriends: 0,
        userId: users.host,
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await api("/concerts/c/parties", "host", "POST", {
        capacity: 1,
        section: "pit",
        spend_band: 2,
        arrival_plan: "mid",
      })
    ).status,
    409,
  );
});
test("host and friend supply preferences, publish together and keep friend places separate", async () => {
  assert.equal(
    (
      await api(`/groups/${party}/settings`, "host", "PUT", {
        expectedFriends: 1,
        strangerPlaces: 2,
      })
    ).status,
    200,
  );
  invite = (await api(`/groups/${party}/friend-invites`, "host", "POST")).body
    .invitation;
  assert.equal(
    (
      await api(
        `/group-friend-invites/${invite.token}/accept`,
        "friend",
        "POST",
      )
    ).status,
    200,
  );
  assert.equal(
    (await api(`/groups/${party}/publish`, "host", "POST", {})).status,
    409,
  );
  for (const u of ["host", "friend"])
    assert.equal(
      (await api(`/groups/${party}/member-preferences`, u, "PUT", answers))
        .status,
      200,
    );
  assert.equal(
    (
      await api(`/groups/${party}/publish`, "host", "POST", {
        connectOpen: true,
      })
    ).status,
    200,
  );
  const group = (await api(`/groups/${party}/membership`, "friend")).body.group;
  assert.equal(group.members.length, 2);
  assert.equal(group.strangerPlaces, 2);
  assert.equal(
    (await api(`/groups/${party}/membership`, "outsider")).status,
    403,
  );
});
test("ranked discovery paginates before display, validates limits and preserves custom meanings", async () => {
  assert.equal(
    (
      await api("/concerts/c/requests", "seeker", "POST", {
        section_pref: "pit",
        spend_band_max: 3,
        arrival_pref: "mid",
      })
    ).status,
    201,
  );
  assert.equal(
    (await api("/me/discovery-preferences/c", "seeker", "PUT", answers)).status,
    200,
  );
  const result = await api("/groups/discover/c?limit=20", "seeker");
  assert.equal(result.status, 200);
  assert.equal(result.body.limit, 20);
  assert.equal(result.body.total, 1);
  assert.ok(
    result.body.groups[0].reasons.some((r) => r.concept === "post_supper"),
  );
  assert.equal(
    (await api("/groups/discover/c?limit=999", "seeker")).status,
    400,
  );
  assert.equal(
    (await api("/groups/discover/c?offset=20", "seeker")).body.groups.length,
    0,
  );
  assert.equal(
    (await api("/preference-concepts?q=makan", "seeker")).body.concepts[0].id,
    "post_supper",
  );
  assert.equal(
    (
      await api("/me/discovery-preferences/c", "seeker", "PUT", {
        about: [{ text: "made up", conceptId: "fake" }],
      })
    ).status,
    400,
  );
});
test("host approval creates membership once and notification APIs remain recipient scoped", async () => {
  const r = await api(`/groups/${party}/join-requests`, "seeker", "POST");
  assert.equal(r.status, 200);
  join = r.body.request.id;
  assert.equal(repos.parties.findById(party).remaining_capacity, 2);
  assert.equal(
    (
      await api(`/group-join-requests/${join}/respond`, "seeker", "POST", {
        action: "accept",
      })
    ).status,
    404,
  );
  assert.equal(
    (
      await api(`/group-join-requests/${join}/respond`, "host", "POST", {
        action: "accept",
      })
    ).status,
    200,
  );
  assert.equal(repos.parties.findById(party).remaining_capacity, 1);
  const inbox = (await api("/me/notifications", "host")).body.notifications;
  assert.ok(inbox.length);
  assert.equal(
    (await api(`/me/notifications/${inbox[0].id}/read`, "outsider", "POST"))
      .status,
    404,
  );
  assert.equal(
    (await api("/me/group-join-requests", "outsider")).body.requests.length,
    0,
  );
  assert.equal(
    (await api("/me/notification-preferences", "host", "PUT", { chat: false }))
      .status,
    200,
  );
  assert.equal(
    (await api("/me/notification-preferences", "host")).body.preferences.chat,
    false,
  );
});
test("meetup HTTP flow keeps locations private, rejects stale revisions and supports discussion", async () => {
  const r = await api("/meetups", "friend", "POST", {
    partyId: party,
    title: "Meet at MRT",
    startsAt: "2030-12-01T10:00:00+08:00",
    endsAt: "2030-12-01T12:00:00+08:00",
  });
  assert.equal(r.status, 200);
  meetup = r.body.meetup.id;
  assert.equal((await api(`/meetups/${meetup}`, "outsider")).status, 404);
  assert.equal(
    (
      await api(`/meetups/${meetup}/availability`, "friend", "PUT", {
        windows: [
          {
            startsAt: "2030-12-01T10:00:00+08:00",
            endsAt: "2030-12-01T11:00:00+08:00",
            latitude: 1.3,
            longitude: 103.8,
          },
        ],
      })
    ).status,
    200,
  );
  const p = await api(`/meetups/${meetup}/places`, "seeker", "POST", {
    label: "MRT entrance",
    latitude: 1.3,
    longitude: 103.8,
  });
  assert.equal(p.status, 200);
  const detail = (await api(`/meetups/${meetup}`, "host")).body.meetup;
  assert.equal(detail.availability.length, 0);
  assert.equal(detail.grid[0].availableCount, 1);
  const plan = await api(`/meetups/${meetup}/propose`, "friend", "POST", {
    version: detail.version,
    placeId: p.body.place.id,
    startsAt: "2030-12-01T10:00:00+08:00",
  });
  assert.equal(plan.status, 200);
  assert.equal(
    (
      await api(`/meetups/${meetup}/approve`, "host", "POST", {
        version: detail.version,
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await api(`/meetups/${meetup}/approve`, "host", "POST", {
        version: plan.body.proposal.version,
      })
    ).body.approval.confirmed,
    true,
  );
  assert.equal(
    (
      await api(`/meetups/${meetup}/comments`, "seeker", "POST", {
        body: "Sheltered entrance please",
      })
    ).status,
    200,
  );
  assert.equal(
    (await api(`/meetups/${meetup}/weather`, "host")).body.weather.status,
    "unavailable",
  );
});
test("feedback HTTP flow excludes post-event joiners, protects private history and updates eligible feedback", async () => {
  assert.equal(
    (
      await api("/feedback", "outsider", "POST", {
        partyId: party,
        ratedUserId: users.friend,
        showedUp: true,
        rating: 5,
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await api("/feedback", "host", "POST", {
        partyId: party,
        ratedUserId: users.friend,
        showedUp: true,
        rating: 8,
      })
    ).status,
    400,
  );
  db.prepare("UPDATE concerts SET event_date='2020-01-01' WHERE id='c'").run();
  assert.equal(
    (
      await api("/feedback", "host", "POST", {
        partyId: party,
        ratedUserId: users.friend,
        showedUp: true,
        rating: 5,
      })
    ).status,
    403,
  );
  db.prepare(
    "UPDATE parties SET created_at='2019-01-01 00:00:00' WHERE id=?",
  ).run(party);
  db.prepare(
    "UPDATE group_memberships SET joined_at='2019-01-01 00:00:00' WHERE party_id=?",
  ).run(party);
  assert.equal(
    (
      await api("/feedback", "host", "POST", {
        partyId: party,
        ratedUserId: users.friend,
        showedUp: true,
        rating: 5,
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await api("/feedback", "host", "POST", {
        partyId: party,
        ratedUserId: users.friend,
        showedUp: true,
        rating: 5,
      })
    ).status,
    409,
  );
  assert.equal((await api("/me/feedback", "outsider")).body.feedback.length, 0);
  assert.equal(
    (await api("/operator/group-membership-conflicts", "outsider")).status,
    403,
  );
});
