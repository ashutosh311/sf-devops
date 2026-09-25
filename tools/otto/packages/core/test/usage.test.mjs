import { test } from "node:test";
import assert from "node:assert/strict";
import { pickUsageIdentity, isSlalomEmail, validateSlalomEmail, slalomEmailForLogin } from "../dist/index.js";

const pick = (emails, names = [], override) => pickUsageIdentity({ emails, names }, override);

test("explicit override wins over everything", () => {
  assert.equal(pick(["jane.doe@slalom.com"], ["Jane Doe"], "Jane.Doe2@Slalom.com"), "jane.doe2@slalom.com");
});

test("override without @ is ignored", () => {
  assert.equal(pick(["jane.doe@slalom.com"], [], "jane"), "jane.doe@slalom.com");
});

test("a Slalom email is preferred over an earlier client email", () => {
  assert.equal(pick(["ankit.gangwani@ytlgroup.co.uk", "Ankit.Gangwani@Slalom.com"]), "ankit.gangwani@slalom.com");
});

test("never guesses a Slalom address from a client email or a name", () => {
  assert.equal(pick(["ankit.gangwani@ytlgroup.co.uk"], ["Ankit Gangwani"]), "ankit.gangwani@ytlgroup.co.uk");
  assert.equal(pick([], ["Ankit Gangwani"]), "Ankit Gangwani");
  assert.equal(pick([], []), "unknown");
});

test("isSlalomEmail / validateSlalomEmail accept only a full slalom.com address", () => {
  assert.equal(isSlalomEmail(" Jane.Doe@Slalom.com "), true);
  for (const bad of ["jane@client.com", "jane@slalom.com.evil", "jane@notslalom.com", "@slalom.com", "jane doe@slalom.com", ""]) {
    assert.equal(isSlalomEmail(bad), false, bad);
    assert.ok(validateSlalomEmail(bad), bad);
  }
  assert.equal(validateSlalomEmail("jane.doe@slalom.com"), undefined);
});

test("login-name suggestion only for first.last-shaped logins", () => {
  assert.equal(slalomEmailForLogin("mark.wraith"), "mark.wraith@slalom.com");
  assert.equal(slalomEmailForLogin(" Mary-Jane.Smith "), "mary-jane.smith@slalom.com");
  for (const bad of ["john", "admin", "root", "jdoe1", "a.b.c", ".doe", "jane.", "jane doe", ""]) {
    assert.equal(slalomEmailForLogin(bad), undefined, bad);
  }
});
