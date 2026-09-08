# SkinSense — Test Case Documentation

**Project:** SkinSense AI Dermatological Screening System  
**Standard:** IEEE 829  
**Total Test Cases:** 193  
**All Status:** PASS  

---

## Legend

| Field | Meaning |
|---|---|
| Module | Service and endpoint or function under test |
| Test Type | Integration / Unit / Contract |
| Pre-conditions | Mock setup or system state required before the test runs |
| Test Steps | Actions performed |
| Test Data | Input values sent |
| Expected Output | What the test asserts |
| Actual Output | Observed result |
| Status | PASS / FAIL |

---

## 1. Auth Routes — `server/tests/auth.test.js`

### TC-AUTH-001 — Register patient with all profile fields
| | |
|---|---|
| **Module** | Auth / POST /api/auth/register |
| **Test Type** | Integration |
| **Pre-conditions** | db.query mocked x4 in order: duplicate check → empty rows; users INSERT → `{user_id:1, username:'alice', role:'patient'}`; patient_profiles INSERT → ok; audit_logs INSERT → ok. bcrypt.hash → fixed hash. |
| **Test Steps** | POST /api/auth/register with full patient body |
| **Test Data** | username=alice, email=alice@test.com, password=pass123, role=patient, age=25, gender=F, region=Islamabad |
| **Expected Output** | HTTP 201; body.token present; body.user = {username:'alice', role:'patient'}; JWT decodes to userId=1 |
| **Actual Output** | As expected |
| **Status** | ✅ PASS |

### TC-AUTH-002 — Register clinician
| | |
|---|---|
| **Module** | Auth / POST /api/auth/register |
| **Test Type** | Integration |
| **Pre-conditions** | db.query mocked x4: no duplicate; users INSERT → `{user_id:2, username:'dr_sara', role:'clinician'}`; clinician_profiles INSERT → ok; audit_logs → ok |
| **Test Steps** | POST /api/auth/register with role=clinician |
| **Test Data** | username=dr_sara, email=sara@clinic.com, password=securepass, role=clinician |
| **Expected Output** | HTTP 201; body.user.role=clinician; token present |
| **Actual Output** | As expected |
| **Status** | ✅ PASS |

### TC-AUTH-003 — Register clinician with minimal required fields only
| | |
|---|---|
| **Module** | Auth / POST /api/auth/register |
| **Test Type** | Integration |
| **Pre-conditions** | db.query mocked x4: no duplicate; users INSERT → `{user_id:3, username:'dr_min', role:'clinician'}`; clinician_profiles → ok; audit_logs → ok |
| **Test Steps** | POST /api/auth/register with role=clinician, no age/gender/region |
| **Test Data** | username=dr_min, email=dr_min@test.com, password=pass123, role=clinician |
| **Expected Output** | HTTP 201; token present (clinicians are not required to supply age/gender/region) |
| **Actual Output** | As expected |
| **Status** | ✅ PASS |

### TC-AUTH-004 — Default role to patient when role is omitted
| | |
|---|---|
| **Module** | Auth / POST /api/auth/register |
| **Test Type** | Integration |
| **Pre-conditions** | db.query mocked x4: no duplicate; users INSERT → `{user_id:4, username:'dave', role:'patient'}`; patient_profiles → ok; audit_logs → ok |
| **Test Steps** | POST /api/auth/register without role field |
| **Test Data** | username=dave, email=dave@test.com, password=pass123, age=30, gender=M, region=Lahore |
| **Expected Output** | HTTP 201; body.user.role=patient |
| **Actual Output** | As expected |
| **Status** | ✅ PASS |

### TC-AUTH-005 — Returns 400 for a negative age
| | |
|---|---|
| **Module** | Auth / POST /api/auth/register |
| **Test Type** | Integration |
| **Pre-conditions** | No DB mocks needed; controller returns before querying |
| **Test Steps** | POST /api/auth/register with age=-5 |
| **Test Data** | username=alice, email=alice@test.com, password=pass123, age=-5, gender=F, region=Islamabad |
| **Expected Output** | HTTP 400; body.error matches /age/i |
| **Actual Output** | As expected |
| **Status** | ✅ PASS |

### TC-AUTH-006 — Returns 400 for age above 120
| | |
|---|---|
| **Module** | Auth / POST /api/auth/register |
| **Test Type** | Integration |
| **Pre-conditions** | No DB mocks needed |
| **Test Steps** | POST /api/auth/register with age=999 |
| **Test Data** | username=alice, email=alice@test.com, password=pass123, age=999, gender=F, region=Islamabad |
| **Expected Output** | HTTP 400; body.error matches /age/i |
| **Actual Output** | As expected |
| **Status** | ✅ PASS |

### TC-AUTH-007 — Returns 400 for a decimal age
| | |
|---|---|
| **Module** | Auth / POST /api/auth/register |
| **Test Type** | Integration |
| **Pre-conditions** | No DB mocks needed |
| **Test Steps** | POST /api/auth/register with age=25.5 |
| **Test Data** | username=alice, email=alice@test.com, password=pass123, age=25.5, gender=F, region=Islamabad |
| **Expected Output** | HTTP 400; body.error matches /age/i |
| **Actual Output** | As expected |
| **Status** | ✅ PASS |

### TC-AUTH-008 — Returns 400 for age zero
| | |
|---|---|
| **Module** | Auth / POST /api/auth/register |
| **Test Type** | Integration |
| **Pre-conditions** | No DB mocks needed. Note: age=0 passes the "required" guard (`!age && age!==0` is false) but fails the value guard (`ageNum < 1`). gender and region must be provided so the controller reaches that guard. |
| **Test Steps** | POST /api/auth/register with age=0 |
| **Test Data** | username=alice, email=alice@test.com, password=pass123, age=0, gender=F, region=Islamabad |
| **Expected Output** | HTTP 400; body.error matches /age/i |
| **Actual Output** | As expected |
| **Status** | ✅ PASS |

### TC-AUTH-009 — Accepts valid boundary ages (1 and 120)
| | |
|---|---|
| **Module** | Auth / POST /api/auth/register |
| **Test Type** | Integration |
| **Pre-conditions** | db.query mocked x4 per iteration (loop runs twice for age=1 then age=120) |
| **Test Steps** | Loop POST /api/auth/register twice with ages 1 and 120 |
| **Test Data** | age=1 (username=user1); age=120 (username=user120); both with gender=F, region=Islamabad |
| **Expected Output** | HTTP 201 for both iterations |
| **Actual Output** | As expected |
| **Status** | ✅ PASS |

### TC-AUTH-010 — Returns 409 when username or email is already taken
| | |
|---|---|
| **Module** | Auth / POST /api/auth/register |
| **Test Type** | Integration |
| **Pre-conditions** | db.query mocked x1: duplicate check returns existing row `{user_id:99}` |
| **Test Steps** | POST /api/auth/register with existing credentials |
| **Test Data** | username=alice, email=alice@test.com, password=pass123, age=25, gender=F, region=Islamabad |
| **Expected Output** | HTTP 409; body.error matches /already taken/i |
| **Actual Output** | As expected |
| **Status** | ✅ PASS |

### TC-AUTH-011 — Returns 500 when the database throws on register
| | |
|---|---|
| **Module** | Auth / POST /api/auth/register |
| **Test Type** | Integration |
| **Pre-conditions** | db.query.mockRejectedValueOnce(new Error('DB connection lost')) |
| **Test Steps** | POST /api/auth/register with valid data |
| **Test Data** | username=charlie, email=charlie@test.com, password=pass123, age=30, gender=M, region=Lahore |
| **Expected Output** | HTTP 500; body.error matches /registration failed/i |
| **Actual Output** | As expected |
| **Status** | ✅ PASS |

### TC-AUTH-012 — Login returns a JWT for valid credentials
| | |
|---|---|
| **Module** | Auth / POST /api/auth/login |
| **Test Type** | Integration |
| **Pre-conditions** | db.query x2: user SELECT returns `{user_id:1, username:'alice', password_hash:'$2b$12$mockedhash', role:'patient'}`; audit_log → ok. bcrypt.compare → true |
| **Test Steps** | POST /api/auth/login with correct credentials |
| **Test Data** | username=alice, password=pass123 |
| **Expected Output** | HTTP 200; body.token present; body.user = {username:'alice', role:'patient'} |
| **Actual Output** | As expected |
| **Status** | ✅ PASS |

### TC-AUTH-013 — Login returns 401 for an unknown username
| | |
|---|---|
| **Module** | Auth / POST /api/auth/login |
| **Test Type** | Integration |
| **Pre-conditions** | db.query x1: SELECT returns empty rows |
| **Test Steps** | POST /api/auth/login with non-existent username |
| **Test Data** | username=ghost, password=pass123 |
| **Expected Output** | HTTP 401; body.error matches /invalid credentials/i |
| **Actual Output** | As expected |
| **Status** | ✅ PASS |

### TC-AUTH-014 — Login returns 401 for correct username but wrong password
| | |
|---|---|
| **Module** | Auth / POST /api/auth/login |
| **Test Type** | Integration |
| **Pre-conditions** | db.query x1: user row returned; bcrypt.compare → false |
| **Test Steps** | POST /api/auth/login with correct username, wrong password |
| **Test Data** | username=alice, password=wrongpassword |
| **Expected Output** | HTTP 401; body.error matches /invalid credentials/i |
| **Actual Output** | As expected |
| **Status** | ✅ PASS |

### TC-AUTH-015 — Login returns 500 when database throws
| | |
|---|---|
| **Module** | Auth / POST /api/auth/login |
| **Test Type** | Integration |
| **Pre-conditions** | db.query.mockRejectedValueOnce(new Error('DB down')) |
| **Test Steps** | POST /api/auth/login |
| **Test Data** | username=alice, password=pass123 |
| **Expected Output** | HTTP 500; body.error matches /login failed/i |
| **Actual Output** | As expected |
| **Status** | ✅ PASS |

### TC-AUTH-016 — Login does not leak which field is wrong (no username enumeration)
| | |
|---|---|
| **Module** | Auth / POST /api/auth/login |
| **Test Type** | Integration (Security) |
| **Pre-conditions** | First call: db.query → empty rows (user not found). Second call: db.query → user row; bcrypt.compare → false |
| **Test Steps** | 1. POST login with non-existent username. 2. POST login with correct username but wrong password. 3. Compare error messages |
| **Test Data** | Call 1: username=nobody, password=x. Call 2: username=alice, password=bad |
| **Expected Output** | res1.body.error === res2.body.error (identical messages for both failure modes) |
| **Actual Output** | As expected |
| **Status** | ✅ PASS |

### TC-AUTH-017 — Logout blacklists the token and returns success
| | |
|---|---|
| **Module** | Auth / POST /api/auth/logout |
| **Test Type** | Integration |
| **Pre-conditions** | Valid JWT signed with test secret; db.query x1: audit_log → ok |
| **Test Steps** | POST /api/auth/logout with valid Bearer token |
| **Test Data** | Authorization: Bearer {valid JWT} |
| **Expected Output** | HTTP 200; body.success=true |
| **Actual Output** | As expected |
| **Status** | ✅ PASS |

### TC-AUTH-018 — Blacklisted token is rejected on subsequent requests
| | |
|---|---|
| **Module** | Auth / POST /api/auth/logout |
| **Test Type** | Integration |
| **Pre-conditions** | Valid JWT; db.query.mockResolvedValue (persistent, covers both calls) |
| **Test Steps** | 1. POST logout with token (succeeds). 2. POST logout again with the same token |
| **Test Data** | Same JWT used for both requests |
| **Expected Output** | First request: HTTP 200. Second request: HTTP 401; body.error matches /revoked/i |
| **Actual Output** | As expected |
| **Status** | ✅ PASS |

### TC-AUTH-019 — Logout returns 401 with no Authorization header
| | |
|---|---|
| **Module** | Auth / POST /api/auth/logout |
| **Test Type** | Integration |
| **Pre-conditions** | None |
| **Test Steps** | POST /api/auth/logout with no headers |
| **Test Data** | (none) |
| **Expected Output** | HTTP 401 |
| **Actual Output** | As expected |
| **Status** | ✅ PASS |

### TC-AUTH-020 — Logout returns 500 when database throws
| | |
|---|---|
| **Module** | Auth / POST /api/auth/logout |
| **Test Type** | Integration |
| **Pre-conditions** | Valid JWT; db.query.mockRejectedValueOnce(new Error('DB error')) |
| **Test Steps** | POST /api/auth/logout |
| **Test Data** | Authorization: Bearer {valid JWT} |
| **Expected Output** | HTTP 500; body.error matches /logout failed/i |
| **Actual Output** | As expected |
| **Status** | ✅ PASS |

### TC-AUTH-021 — Profile returns patient user and profile data
| | |
|---|---|
| **Module** | Auth / GET /api/auth/profile |
| **Test Type** | Integration |
| **Pre-conditions** | db.query x2: users SELECT → `{user_id:1, username:'alice', email:'alice@test.com', role:'patient'}`; patient_profiles SELECT → `{patient_id:1, age:25, gender:'F', region:'Islamabad'}` |
| **Test Steps** | GET /api/auth/profile with patient token |
| **Test Data** | Authorization: Bearer {patient JWT, userId=1} |
| **Expected Output** | HTTP 200; body.username=alice; body.role=patient; body.profile.age=25; body.profile.gender=F |
| **Actual Output** | As expected |
| **Status** | ✅ PASS |

### TC-AUTH-022 — Profile returns clinician user and profile data
| | |
|---|---|
| **Module** | Auth / GET /api/auth/profile |
| **Test Type** | Integration |
| **Pre-conditions** | db.query x2: clinician user row; clinician_profiles row |
| **Test Steps** | GET /api/auth/profile with clinician token |
| **Test Data** | Authorization: Bearer {clinician JWT, userId=2, username=dr_sara} |
| **Expected Output** | HTTP 200; body.role=clinician |
| **Actual Output** | As expected |
| **Status** | ✅ PASS |

### TC-AUTH-023 — Profile returns null when profile row does not exist yet
| | |
|---|---|
| **Module** | Auth / GET /api/auth/profile |
| **Test Type** | Integration |
| **Pre-conditions** | db.query x2: users SELECT returns user row; profile SELECT returns empty rows |
| **Test Steps** | GET /api/auth/profile |
| **Test Data** | Authorization: Bearer {JWT, userId=5} |
| **Expected Output** | HTTP 200; body.profile=null |
| **Actual Output** | As expected |
| **Status** | ✅ PASS |

### TC-AUTH-024 — Profile returns 401 with no token
| | |
|---|---|
| **Module** | Auth / GET /api/auth/profile |
| **Test Type** | Integration |
| **Pre-conditions** | None |
| **Test Steps** | GET /api/auth/profile with no Authorization header |
| **Test Data** | (none) |
| **Expected Output** | HTTP 401; body.error matches /authentication required/i |
| **Actual Output** | As expected |
| **Status** | ✅ PASS |

### TC-AUTH-025 — Profile returns 401 with an expired token
| | |
|---|---|
| **Module** | Auth / GET /api/auth/profile |
| **Test Type** | Integration |
| **Pre-conditions** | JWT manually constructed with `exp` set 3600 seconds in the past |
| **Test Steps** | GET /api/auth/profile with expired token |
| **Test Data** | Authorization: Bearer {expired JWT} |
| **Expected Output** | HTTP 401; body.error matches /expired/i |
| **Actual Output** | As expected |
| **Status** | ✅ PASS |

### TC-AUTH-026 — Profile returns 401 with a tampered token
| | |
|---|---|
| **Module** | Auth / GET /api/auth/profile |
| **Test Type** | Integration (Security) |
| **Pre-conditions** | Valid JWT with last 10 characters replaced with 'tampered!!' |
| **Test Steps** | GET /api/auth/profile with tampered token |
| **Test Data** | Authorization: Bearer {tampered JWT} |
| **Expected Output** | HTTP 401 |
| **Actual Output** | As expected |
| **Status** | ✅ PASS |

### TC-AUTH-027 — Profile returns 401 with malformed Bearer (no token after space)
| | |
|---|---|
| **Module** | Auth / GET /api/auth/profile |
| **Test Type** | Integration |
| **Pre-conditions** | None |
| **Test Steps** | GET /api/auth/profile with Authorization: Bearer (trailing space only) |
| **Test Data** | Authorization: "Bearer " |
| **Expected Output** | HTTP 401 |
| **Actual Output** | As expected |
| **Status** | ✅ PASS |

### TC-AUTH-028 — Profile returns 500 when database throws
| | |
|---|---|
| **Module** | Auth / GET /api/auth/profile |
| **Test Type** | Integration |
| **Pre-conditions** | Valid JWT; db.query.mockRejectedValueOnce(new Error('DB error')) |
| **Test Steps** | GET /api/auth/profile |
| **Test Data** | Authorization: Bearer {valid JWT} |
| **Expected Output** | HTTP 500; body.error matches /failed to fetch profile/i |
| **Actual Output** | As expected |
| **Status** | ✅ PASS |

---

## 2. Screening Routes — `server/tests/screening.test.js`

### TC-SCR-001 — Creates a new screening case and returns case_id
| | |
|---|---|
| **Module** | Screening / POST /api/screening/create |
| **Test Type** | Integration |
| **Pre-conditions** | db.query x2: INSERT → `{case_id:'test-case-uuid-001', status:'pending', created_at:...}`; audit_log → ok |
| **Test Steps** | POST /api/screening/create with patient token |
| **Test Data** | Authorization: Bearer {PATIENT_TOKEN} |
| **Expected Output** | HTTP 201; body.case_id=test-case-uuid-001; body.status=pending |
| **Actual Output** | As expected |
| **Status** | ✅ PASS |

### TC-SCR-002 — Create screening returns 401 without auth token
| | |
|---|---|
| **Module** | Screening / POST /api/screening/create |
| **Test Type** | Integration |
| **Pre-conditions** | None |
| **Test Steps** | POST /api/screening/create with no Authorization header |
| **Test Data** | (none) |
| **Expected Output** | HTTP 401 |
| **Actual Output** | As expected |
| **Status** | ✅ PASS |

### TC-SCR-003 — Create screening returns 500 when database throws
| | |
|---|---|
| **Module** | Screening / POST /api/screening/create |
| **Test Type** | Integration |
| **Pre-conditions** | db.query.mockRejectedValueOnce(new Error('DB error')) |
| **Test Steps** | POST /api/screening/create |
| **Test Data** | Authorization: Bearer {PATIENT_TOKEN} |
| **Expected Output** | HTTP 500; body.error matches /failed to create screening/i |
| **Actual Output** | As expected |
| **Status** | ✅ PASS |

### TC-SCR-004 — Upload image: JPEG accepted, returns image_id
| | |
|---|---|
| **Module** | Screening / POST /api/screening/:caseId/upload-image |
| **Test Type** | Integration |
| **Pre-conditions** | db.query x2: images INSERT → `{image_id:42}`; audit_log → ok |
| **Test Steps** | POST upload-image with real JPEG buffer (1×1 px, base64-encoded) |
| **Test Data** | MINIMAL_JPEG buffer; filename=skin.jpg; contentType=image/jpeg |
| **Expected Output** | HTTP 200; body.image_id=42; body.message matches /uploaded/i |
| **Actual Output** | As expected |
| **Status** | ✅ PASS |

### TC-SCR-005 — Upload image: PNG accepted
| | |
|---|---|
| **Module** | Screening / POST /api/screening/:caseId/upload-image |
| **Test Type** | Integration |
| **Pre-conditions** | db.query x2: images INSERT → `{image_id:43}`; audit_log → ok |
| **Test Steps** | POST upload-image with PNG header bytes |
| **Test Data** | 8-byte PNG magic header; contentType=image/png |
| **Expected Output** | HTTP 200; body.image_id=43 |
| **Actual Output** | As expected |
| **Status** | ✅ PASS |

### TC-SCR-006 — Upload image: returns 400 when no file attached
| | |
|---|---|
| **Module** | Screening / POST /api/screening/:caseId/upload-image |
| **Test Type** | Integration |
| **Pre-conditions** | None |
| **Test Steps** | POST upload-image with empty JSON body |
| **Test Data** | {} |
| **Expected Output** | HTTP 400; body.error matches /no image file/i |
| **Actual Output** | As expected |
| **Status** | ✅ PASS |

### TC-SCR-007 — Upload image: rejects non-image MIME type (PDF)
| | |
|---|---|
| **Module** | Screening / POST /api/screening/:caseId/upload-image |
| **Test Type** | Integration |
| **Pre-conditions** | Multer imageUpload filter configured to reject non-JPEG/PNG |
| **Test Steps** | POST upload-image with PDF buffer |
| **Test Data** | Buffer '%PDF-1.4'; contentType=application/pdf |
| **Expected Output** | HTTP 500 (multer error propagated to Express error handler) |
| **Actual Output** | As expected |
| **Status** | ✅ PASS |

### TC-SCR-008 — Upload image: returns 401 without auth token
| | |
|---|---|
| **Module** | Screening / POST /api/screening/:caseId/upload-image |
| **Test Type** | Integration |
| **Pre-conditions** | None |
| **Test Steps** | POST upload-image with JPEG but no Authorization header |
| **Test Data** | MINIMAL_JPEG; no token |
| **Expected Output** | HTTP 401 |
| **Actual Output** | As expected |
| **Status** | ✅ PASS |

### TC-SCR-009 — Upload image: returns 500 when database throws after upload
| | |
|---|---|
| **Module** | Screening / POST /api/screening/:caseId/upload-image |
| **Test Type** | Integration |
| **Pre-conditions** | db.query.mockRejectedValueOnce(new Error('DB error')) |
| **Test Steps** | POST upload-image with valid JPEG |
| **Test Data** | MINIMAL_JPEG; PATIENT_TOKEN |
| **Expected Output** | HTTP 500; body.error matches /image upload failed/i |
| **Actual Output** | As expected |
| **Status** | ✅ PASS |

### TC-SCR-010 — Voice: saves transcript with graceful ASR fallback when Python unreachable
| | |
|---|---|
| **Module** | Screening / POST /api/screening/:caseId/voice |
| **Test Type** | Integration (graceful degradation) |
| **Pre-conditions** | Python inference service is NOT mocked — ECONNREFUSED triggers the fallback path. db.query x2: voice_transcripts INSERT → `{transcript_id:7}`; UPDATE screening_cases → ok |
| **Test Steps** | POST voice with silent WAV and language=ur |
| **Test Data** | 46-byte hand-crafted silent WAV; language=ur |
| **Expected Output** | HTTP 200; body.transcript_id=7; body.asr_available=false; body.transcript_text=null |
| **Actual Output** | As expected |
| **Status** | ✅ PASS |

### TC-SCR-011 — Voice: handles audio/webm;codecs=opus MIME type (Chrome default)
| | |
|---|---|
| **Module** | Screening / POST /api/screening/:caseId/voice |
| **Test Type** | Integration |
| **Pre-conditions** | db.query x2: transcript INSERT; UPDATE |
| **Test Steps** | POST voice with webm buffer and codec suffix in MIME type |
| **Test Data** | Buffer 'webm audio data'; contentType=audio/webm;codecs=opus; language=en |
| **Expected Output** | HTTP 200; body.transcript_id present |
| **Actual Output** | As expected |
| **Status** | ✅ PASS |

### TC-SCR-012 — Voice: returns 400 when no audio file attached
| | |
|---|---|
| **Module** | Screening / POST /api/screening/:caseId/voice |
| **Test Type** | Integration |
| **Pre-conditions** | None |
| **Test Steps** | POST voice with JSON body only (no multipart file) |
| **Test Data** | {language: 'ur'} |
| **Expected Output** | HTTP 400; body.error matches /no audio file/i |
| **Actual Output** | As expected |
| **Status** | ✅ PASS |

### TC-SCR-013 — Voice: rejects non-audio MIME type (image/png)
| | |
|---|---|
| **Module** | Screening / POST /api/screening/:caseId/voice |
| **Test Type** | Integration |
| **Pre-conditions** | Multer audioUpload filter configured to reject non-audio/* types |
| **Test Steps** | POST voice with PNG buffer |
| **Test Data** | Buffer 'fake png'; contentType=image/png |
| **Expected Output** | HTTP 500 (multer error propagated) |
| **Actual Output** | As expected |
| **Status** | ✅ PASS |

### TC-SCR-014 — Voice: returns 401 without auth token
| | |
|---|---|
| **Module** | Screening / POST /api/screening/:caseId/voice |
| **Test Type** | Integration |
| **Pre-conditions** | None |
| **Test Steps** | POST voice with WAV but no Authorization header |
| **Test Data** | silentWav; language=ur; no token |
| **Expected Output** | HTTP 401 |
| **Actual Output** | As expected |
| **Status** | ✅ PASS |

### TC-SCR-015 — Voice: returns 500 when database throws after ASR fallback
| | |
|---|---|
| **Module** | Screening / POST /api/screening/:caseId/voice |
| **Test Type** | Integration |
| **Pre-conditions** | db.query.mockRejectedValueOnce(new Error('DB error')) |
| **Test Steps** | POST voice with valid WAV |
| **Test Data** | silentWav; language=ur; PATIENT_TOKEN |
| **Expected Output** | HTTP 500; body.error matches /voice processing failed/i |
| **Actual Output** | As expected |
| **Status** | ✅ PASS |

### TC-SCR-016 — Inference: falls back to mock prediction when image file missing on disk
| | |
|---|---|
| **Module** | Screening / POST /api/screening/:caseId/inference |
| **Test Type** | Integration (graceful degradation) |
| **Pre-conditions** | db.query x3: case/image SELECT → `{file_path:'/nonexistent/test_image.jpg'}`; predictions INSERT → `{prediction_id:55}`; UPDATE screening_cases → ok |
| **Test Steps** | POST inference; inference service fails (file not found); mock prediction generated |
| **Test Data** | PATIENT_TOKEN; case has non-existent file path |
| **Expected Output** | HTTP 200; body.prediction_id=55; body.top_condition present; body.model_version matches /mock/i |
| **Actual Output** | As expected |
| **Status** | ✅ PASS |

### TC-SCR-017 — Inference: returns 400 when no image is linked to the case
| | |
|---|---|
| **Module** | Screening / POST /api/screening/:caseId/inference |
| **Test Type** | Integration |
| **Pre-conditions** | db.query x1: case/image JOIN returns empty rows |
| **Test Steps** | POST inference for case with no uploaded image |
| **Test Data** | PATIENT_TOKEN |
| **Expected Output** | HTTP 400; body.error matches /no image found/i |
| **Actual Output** | As expected |
| **Status** | ✅ PASS |

### TC-SCR-018 — Inference: returns 400 when case exists but image_id is null
| | |
|---|---|
| **Module** | Screening / POST /api/screening/:caseId/inference |
| **Test Type** | Integration |
| **Pre-conditions** | db.query x1: returns `{file_path: null}` |
| **Test Steps** | POST inference for case with null file_path |
| **Test Data** | PATIENT_TOKEN |
| **Expected Output** | HTTP 400; body.error matches /no image found/i |
| **Actual Output** | As expected |
| **Status** | ✅ PASS |

### TC-SCR-019 — Inference: returns 401 without auth token
| | |
|---|---|
| **Module** | Screening / POST /api/screening/:caseId/inference |
| **Test Type** | Integration |
| **Pre-conditions** | None |
| **Test Steps** | POST inference with no Authorization header |
| **Test Data** | (none) |
| **Expected Output** | HTTP 401 |
| **Actual Output** | As expected |
| **Status** | ✅ PASS |

### TC-SCR-020 — Inference: returns 500 when database throws
| | |
|---|---|
| **Module** | Screening / POST /api/screening/:caseId/inference |
| **Test Type** | Integration |
| **Pre-conditions** | db.query.mockRejectedValueOnce(new Error('DB error')) |
| **Test Steps** | POST inference |
| **Test Data** | PATIENT_TOKEN |
| **Expected Output** | HTTP 500; body.error matches /inference failed/i |
| **Actual Output** | As expected |
| **Status** | ✅ PASS |

### TC-SCR-021 — Results: returns case results with prediction data
| | |
|---|---|
| **Module** | Screening / GET /api/screening/:caseId/results |
| **Test Type** | Integration |
| **Pre-conditions** | db.query x1: returns mockRow with top_condition=Eczema, confidence_score=0.87, transcript_id=null |
| **Test Steps** | GET results for a case with prediction but no transcript |
| **Test Data** | PATIENT_TOKEN; CASE_ID |
| **Expected Output** | HTTP 200; body.top_condition=Eczema; body.confidence_score=0.87; body.symptoms=[] |
| **Actual Output** | As expected |
| **Status** | ✅ PASS |

### TC-SCR-022 — Results: returns heatmap_url when heatmap_path is set
| | |
|---|---|
| **Module** | Screening / GET /api/screening/:caseId/results |
| **Test Type** | Integration |
| **Pre-conditions** | db.query x1: mockRow with heatmap_path='abc123.png' |
| **Test Steps** | GET results |
| **Test Data** | PATIENT_TOKEN; CASE_ID |
| **Expected Output** | HTTP 200; body.heatmap_url contains 'abc123.png' |
| **Actual Output** | As expected |
| **Status** | ✅ PASS |

### TC-SCR-023 — Results: fetches extracted symptoms when transcript_id is present
| | |
|---|---|
| **Module** | Screening / GET /api/screening/:caseId/results |
| **Test Type** | Integration |
| **Pre-conditions** | db.query x2: case row with transcript_id=3; extracted_symptoms SELECT → `[{keyword:'itching', confidence:0.9}]` |
| **Test Steps** | GET results for case with transcript |
| **Test Data** | PATIENT_TOKEN; CASE_ID |
| **Expected Output** | HTTP 200; body.symptoms=[{keyword:'itching', confidence:0.9}] |
| **Actual Output** | As expected |
| **Status** | ✅ PASS |

### TC-SCR-024 — Results: returns 404 when case does not exist or belongs to another patient
| | |
|---|---|
| **Module** | Screening / GET /api/screening/:caseId/results |
| **Test Type** | Integration |
| **Pre-conditions** | db.query x1: returns empty rows |
| **Test Steps** | GET results for non-existent case ID |
| **Test Data** | PATIENT_TOKEN; caseId=nonexistent-case |
| **Expected Output** | HTTP 404; body.error matches /not found/i |
| **Actual Output** | As expected |
| **Status** | ✅ PASS |

### TC-SCR-025 — Results: returns 401 without auth token
| | |
|---|---|
| **Module** | Screening / GET /api/screening/:caseId/results |
| **Test Type** | Integration |
| **Pre-conditions** | None |
| **Test Steps** | GET results with no Authorization header |
| **Test Data** | (none) |
| **Expected Output** | HTTP 401 |
| **Actual Output** | As expected |
| **Status** | ✅ PASS |

### TC-SCR-026 — Results: returns 500 when database throws
| | |
|---|---|
| **Module** | Screening / GET /api/screening/:caseId/results |
| **Test Type** | Integration |
| **Pre-conditions** | db.query.mockRejectedValueOnce(new Error('DB error')) |
| **Test Steps** | GET results |
| **Test Data** | PATIENT_TOKEN; CASE_ID |
| **Expected Output** | HTTP 500; body.error matches /failed to fetch results/i |
| **Actual Output** | As expected |
| **Status** | ✅ PASS |

### TC-SCR-027 — History: returns array of cases for authenticated patient
| | |
|---|---|
| **Module** | Screening / GET /api/screening/history/list |
| **Test Type** | Integration |
| **Pre-conditions** | db.query x1: returns two case rows (c1=Eczema, c2=Psoriasis) |
| **Test Steps** | GET history/list |
| **Test Data** | PATIENT_TOKEN |
| **Expected Output** | HTTP 200; body length=2; body[0].case_id=c1 |
| **Actual Output** | As expected |
| **Status** | ✅ PASS |

### TC-SCR-028 — History: returns empty array when patient has no cases
| | |
|---|---|
| **Module** | Screening / GET /api/screening/history/list |
| **Test Type** | Integration |
| **Pre-conditions** | db.query x1: returns empty rows |
| **Test Steps** | GET history/list |
| **Test Data** | PATIENT_TOKEN |
| **Expected Output** | HTTP 200; body=[] |
| **Actual Output** | As expected |
| **Status** | ✅ PASS |

### TC-SCR-029 — History: returns 401 without auth token
| | |
|---|---|
| **Module** | Screening / GET /api/screening/history/list |
| **Test Type** | Integration |
| **Pre-conditions** | None |
| **Test Steps** | GET history/list with no Authorization header |
| **Test Data** | (none) |
| **Expected Output** | HTTP 401 |
| **Actual Output** | As expected |
| **Status** | ✅ PASS |

### TC-SCR-030 — History: returns 500 when database throws
| | |
|---|---|
| **Module** | Screening / GET /api/screening/history/list |
| **Test Type** | Integration |
| **Pre-conditions** | db.query.mockRejectedValueOnce(new Error('DB error')) |
| **Test Steps** | GET history/list |
| **Test Data** | PATIENT_TOKEN |
| **Expected Output** | HTTP 500; body.error matches /failed to fetch history/i |
| **Actual Output** | As expected |
| **Status** | ✅ PASS |

---

## 3. Middleware — `server/tests/middleware.test.js`

### TC-MWR-001 — authenticate: passes through with valid token and attaches req.user
| | |
|---|---|
| **Module** | Middleware / authenticate |
| **Test Type** | Unit |
| **Pre-conditions** | Minimal test app with GET /probe guarded by authenticate; token signed with correct JWT_SECRET |
| **Test Steps** | GET /probe with valid Bearer token |
| **Test Data** | JWT: {userId:5, username:'carol', role:'patient'} |
| **Expected Output** | HTTP 200; body = {userId:5, role:'patient'} |
| **Actual Output** | As expected |
| **Status** | ✅ PASS |

### TC-MWR-002 — authenticate: returns 401 when Authorization header is absent
| | |
|---|---|
| **Module** | Middleware / authenticate |
| **Test Type** | Unit |
| **Pre-conditions** | None |
| **Test Steps** | GET /probe with no headers |
| **Test Data** | (none) |
| **Expected Output** | HTTP 401; body.error matches /authentication required/i |
| **Actual Output** | As expected |
| **Status** | ✅ PASS |

### TC-MWR-003 — authenticate: returns 401 when scheme is not Bearer (e.g. Basic)
| | |
|---|---|
| **Module** | Middleware / authenticate |
| **Test Type** | Unit |
| **Pre-conditions** | None |
| **Test Steps** | GET /probe with Authorization: Basic abc123 |
| **Test Data** | Authorization: Basic abc123 |
| **Expected Output** | HTTP 401; body.error matches /authentication required/i |
| **Actual Output** | As expected |
| **Status** | ✅ PASS |

### TC-MWR-004 — authenticate: returns 401 for a token signed with a different secret
| | |
|---|---|
| **Module** | Middleware / authenticate |
| **Test Type** | Unit (Security) |
| **Pre-conditions** | Token signed with 'wrong_secret_entirely' instead of JWT_SECRET |
| **Test Steps** | GET /probe with wrong-secret JWT |
| **Test Data** | JWT signed with wrong secret |
| **Expected Output** | HTTP 401 |
| **Actual Output** | As expected |
| **Status** | ✅ PASS |

### TC-MWR-005 — authenticate: returns 401 for a structurally invalid (garbage) token
| | |
|---|---|
| **Module** | Middleware / authenticate |
| **Test Type** | Unit |
| **Pre-conditions** | None |
| **Test Steps** | GET /probe with Bearer not.a.jwt.token.at.all |
| **Test Data** | Authorization: Bearer not.a.jwt.token.at.all |
| **Expected Output** | HTTP 401 |
| **Actual Output** | As expected |
| **Status** | ✅ PASS |

### TC-MWR-006 — authenticate: returns 401 with TokenExpiredError message for an expired token
| | |
|---|---|
| **Module** | Middleware / authenticate |
| **Test Type** | Unit |
| **Pre-conditions** | JWT constructed with exp = now − 3600 seconds |
| **Test Steps** | GET /probe with expired token |
| **Test Data** | JWT with past expiry |
| **Expected Output** | HTTP 401; body.error matches /expired/i |
| **Actual Output** | As expected |
| **Status** | ✅ PASS |

### TC-MWR-007 — authenticate: returns 401 for a blacklisted token
| | |
|---|---|
| **Module** | Middleware / authenticate |
| **Test Type** | Unit |
| **Pre-conditions** | Valid JWT added to in-memory blacklist via addToBlacklist() before request |
| **Test Steps** | GET /probe with blacklisted token |
| **Test Data** | JWT previously blacklisted |
| **Expected Output** | HTTP 401; body.error matches /revoked/i |
| **Actual Output** | As expected |
| **Status** | ✅ PASS |

### TC-MWR-008 — authenticate: token without "Bearer " prefix is rejected
| | |
|---|---|
| **Module** | Middleware / authenticate |
| **Test Type** | Unit (Edge) |
| **Pre-conditions** | Valid JWT but Authorization header has no scheme prefix |
| **Test Steps** | GET /probe with Authorization: {rawToken} (no "Bearer ") |
| **Test Data** | Authorization: {valid JWT without prefix} |
| **Expected Output** | HTTP 401 |
| **Actual Output** | As expected |
| **Status** | ✅ PASS |

### TC-MWR-009 — requireRole: allows clinician token through clinician-only route
| | |
|---|---|
| **Module** | Middleware / requireRole |
| **Test Type** | Unit |
| **Pre-conditions** | Test app built with requireRole('clinician'); clinician JWT |
| **Test Steps** | GET /probe with clinician token |
| **Test Data** | JWT: {userId:2, username:'dr_sara', role:'clinician'} |
| **Expected Output** | HTTP 200; body.role=clinician |
| **Actual Output** | As expected |
| **Status** | ✅ PASS |

### TC-MWR-010 — requireRole: returns 403 when patient hits clinician-only route
| | |
|---|---|
| **Module** | Middleware / requireRole |
| **Test Type** | Unit |
| **Pre-conditions** | Test app built with requireRole('clinician'); patient JWT |
| **Test Steps** | GET /probe with patient token |
| **Test Data** | JWT: {role:'patient'} |
| **Expected Output** | HTTP 403; body.error matches /insufficient permissions/i |
| **Actual Output** | As expected |
| **Status** | ✅ PASS |

### TC-MWR-011 — requireRole: returns 403 when clinician hits patient-only route
| | |
|---|---|
| **Module** | Middleware / requireRole |
| **Test Type** | Unit |
| **Pre-conditions** | Test app built with requireRole('patient'); clinician JWT |
| **Test Steps** | GET /probe with clinician token |
| **Test Data** | JWT: {role:'clinician'} |
| **Expected Output** | HTTP 403; body.error matches /insufficient permissions/i |
| **Actual Output** | As expected |
| **Status** | ✅ PASS |

### TC-MWR-012 — requireRole: returns 401 (not 403) when no token on role-protected route
| | |
|---|---|
| **Module** | Middleware / requireRole |
| **Test Type** | Unit |
| **Pre-conditions** | authenticate runs before requireRole in the chain; no token provided |
| **Test Steps** | GET /probe with no Authorization header on a clinician-only route |
| **Test Data** | (none) |
| **Expected Output** | HTTP 401 (authenticate fires before requireRole — missing token is auth failure, not authz failure) |
| **Actual Output** | As expected |
| **Status** | ✅ PASS |

### TC-MWR-013 — imageUpload: accepts image/jpeg
| | |
|---|---|
| **Module** | Middleware / imageUpload (multer) |
| **Test Type** | Unit |
| **Pre-conditions** | Minimal upload test app wrapping imageUpload.single('file') |
| **Test Steps** | POST /upload with JPEG buffer |
| **Test Data** | Buffer 'jpeg data'; contentType=image/jpeg |
| **Expected Output** | HTTP 200; body.received=true |
| **Actual Output** | As expected |
| **Status** | ✅ PASS |

### TC-MWR-014 — imageUpload: accepts image/png
| | |
|---|---|
| **Module** | Middleware / imageUpload (multer) |
| **Test Type** | Unit |
| **Pre-conditions** | Same upload test app |
| **Test Steps** | POST /upload with PNG buffer |
| **Test Data** | Buffer 'png data'; contentType=image/png |
| **Expected Output** | HTTP 200; body.received=true |
| **Actual Output** | As expected |
| **Status** | ✅ PASS |

### TC-MWR-015 — imageUpload: rejects image/gif
| | |
|---|---|
| **Module** | Middleware / imageUpload (multer) |
| **Test Type** | Unit |
| **Pre-conditions** | Same upload test app |
| **Test Steps** | POST /upload with GIF buffer |
| **Test Data** | Buffer 'gif data'; contentType=image/gif |
| **Expected Output** | HTTP 500; body.error matches /jpeg and png/i |
| **Actual Output** | As expected |
| **Status** | ✅ PASS |

### TC-MWR-016 — imageUpload: rejects application/pdf
| | |
|---|---|
| **Module** | Middleware / imageUpload (multer) |
| **Test Type** | Unit |
| **Pre-conditions** | Same upload test app |
| **Test Steps** | POST /upload with PDF buffer |
| **Test Data** | Buffer '%PDF'; contentType=application/pdf |
| **Expected Output** | HTTP 500; body.error matches /jpeg and png/i |
| **Actual Output** | As expected |
| **Status** | ✅ PASS |

### TC-MWR-017 — audioUpload: accepts audio/wav
| | |
|---|---|
| **Module** | Middleware / audioUpload (multer) |
| **Test Type** | Unit |
| **Pre-conditions** | Minimal upload test app wrapping audioUpload.single('file') |
| **Test Steps** | POST /upload with WAV buffer |
| **Test Data** | Buffer 'wav data'; contentType=audio/wav |
| **Expected Output** | HTTP 200; body.received=true |
| **Actual Output** | As expected |
| **Status** | ✅ PASS |

### TC-MWR-018 — audioUpload: accepts audio/webm;codecs=opus (Chrome codec suffix)
| | |
|---|---|
| **Module** | Middleware / audioUpload (multer) |
| **Test Type** | Unit |
| **Pre-conditions** | audioUpload filter uses startsWith('audio/') not exact match |
| **Test Steps** | POST /upload with webm buffer and codec suffix in MIME type |
| **Test Data** | Buffer 'webm data'; contentType=audio/webm;codecs=opus |
| **Expected Output** | HTTP 200; body.received=true |
| **Actual Output** | As expected |
| **Status** | ✅ PASS |

### TC-MWR-019 — audioUpload: accepts audio/ogg
| | |
|---|---|
| **Module** | Middleware / audioUpload (multer) |
| **Test Type** | Unit |
| **Pre-conditions** | Same upload test app |
| **Test Steps** | POST /upload with OGG buffer |
| **Test Data** | Buffer 'ogg data'; contentType=audio/ogg |
| **Expected Output** | HTTP 200; body.received=true |
| **Actual Output** | As expected |
| **Status** | ✅ PASS |

### TC-MWR-020 — audioUpload: rejects image/png submitted to audio endpoint
| | |
|---|---|
| **Module** | Middleware / audioUpload (multer) |
| **Test Type** | Unit |
| **Pre-conditions** | Same upload test app |
| **Test Steps** | POST /upload with PNG buffer to audio endpoint |
| **Test Data** | Buffer 'png data'; contentType=image/png |
| **Expected Output** | HTTP 500; body.error matches /unsupported audio format/i |
| **Actual Output** | As expected |
| **Status** | ✅ PASS |

### TC-MWR-021 — audioUpload: rejects text/plain submitted to audio endpoint
| | |
|---|---|
| **Module** | Middleware / audioUpload (multer) |
| **Test Type** | Unit |
| **Pre-conditions** | Same upload test app |
| **Test Steps** | POST /upload with text buffer |
| **Test Data** | Buffer 'hello'; contentType=text/plain |
| **Expected Output** | HTTP 500; body.error matches /unsupported audio format/i |
| **Actual Output** | As expected |
| **Status** | ✅ PASS |

---

## 4. useScreening Hook — `client/src/__tests__/useScreening.test.jsx`

### TC-USC-001 — createCase: sets caseId and returns it
| | |
|---|---|
| **Module** | Client / useScreening hook / createCase() |
| **Test Type** | Unit |
| **Pre-conditions** | api.post mocked → `{data: {case_id: 'case-abc'}}` |
| **Test Steps** | renderHook useScreening; call createCase() inside act() |
| **Test Data** | (none — POST /screening/create) |
| **Expected Output** | Return value = 'case-abc'; hook.caseId = 'case-abc'; hook.error = null; hook.loading = false |
| **Actual Output** | As expected |
| **Status** | ✅ PASS |

### TC-USC-002 — createCase: calls POST /screening/create
| | |
|---|---|
| **Module** | Client / useScreening hook / createCase() |
| **Test Type** | Unit (Contract) |
| **Pre-conditions** | api.post mocked → success |
| **Test Steps** | Call createCase(); inspect api.post mock calls |
| **Test Data** | (none) |
| **Expected Output** | api.post called with '/screening/create' |
| **Actual Output** | As expected |
| **Status** | ✅ PASS |

### TC-USC-003 — createCase: sets error and re-throws on API failure
| | |
|---|---|
| **Module** | Client / useScreening hook / createCase() |
| **Test Type** | Unit |
| **Pre-conditions** | api.post mocked to reject with error having response.data.error='Failed to create screening' |
| **Test Steps** | Call createCase() inside act(); catch thrown error |
| **Test Data** | (none) |
| **Expected Output** | Throws; hook.error='Failed to create screening'; hook.caseId=null |
| **Actual Output** | As expected |
| **Status** | ✅ PASS |

### TC-USC-004 — createCase: uses generic message when response has no error field
| | |
|---|---|
| **Module** | Client / useScreening hook / createCase() |
| **Test Type** | Unit |
| **Pre-conditions** | api.post rejects with plain Error('network') — no response.data |
| **Test Steps** | Call createCase(); catch error |
| **Test Data** | (none) |
| **Expected Output** | hook.error='Failed to create screening' (generic fallback message) |
| **Actual Output** | As expected |
| **Status** | ✅ PASS |

### TC-USC-005 — createCase: loading=true during request, false afterwards
| | |
|---|---|
| **Module** | Client / useScreening hook / createCase() |
| **Test Type** | Unit (Edge) |
| **Pre-conditions** | api.post returns a manually-controlled Promise (not auto-resolved) |
| **Test Steps** | Call createCase() without awaiting; assert loading=true; then resolve Promise; assert loading=false |
| **Test Data** | (none) |
| **Expected Output** | loading=true before resolve; loading=false after resolve |
| **Actual Output** | As expected |
| **Status** | ✅ PASS |

### TC-USC-006 — createCase: clears previous error at the start of a new call
| | |
|---|---|
| **Module** | Client / useScreening hook / createCase() |
| **Test Type** | Unit (Edge) |
| **Pre-conditions** | First call: api.post rejects (sets error). Second call: api.post resolves |
| **Test Steps** | Call createCase() twice; assert error is null after second call |
| **Test Data** | (none) |
| **Expected Output** | After first call: hook.error='Old error'. After second call: hook.error=null |
| **Actual Output** | As expected |
| **Status** | ✅ PASS |

### TC-USC-007 — uploadImage: posts image and returns response data
| | |
|---|---|
| **Module** | Client / useScreening hook / uploadImage() |
| **Test Type** | Unit |
| **Pre-conditions** | api.post mocked → `{data: {image_id: 42}}` |
| **Test Steps** | Call uploadImage('case-1', file) inside act() |
| **Test Data** | File('img', 'skin.jpg', {type:'image/jpeg'}) |
| **Expected Output** | Returns {image_id:42}; api.post called with '/screening/case-1/upload-image', FormData, {headers:{'Content-Type':'multipart/form-data'}} |
| **Actual Output** | As expected |
| **Status** | ✅ PASS |

### TC-USC-008 — uploadImage: sets error and re-throws on failure
| | |
|---|---|
| **Module** | Client / useScreening hook / uploadImage() |
| **Test Type** | Unit |
| **Pre-conditions** | api.post rejects with error 'Image upload failed' |
| **Test Steps** | Call uploadImage() and catch |
| **Test Data** | File('img', 'skin.jpg', {type:'image/jpeg'}) |
| **Expected Output** | hook.error='Image upload failed' |
| **Actual Output** | As expected |
| **Status** | ✅ PASS |

### TC-USC-009 — submitVoice: posts WAV audio and returns transcript data
| | |
|---|---|
| **Module** | Client / useScreening hook / submitVoice() |
| **Test Type** | Unit |
| **Pre-conditions** | api.post mocked → `{data: {transcript_id:7, transcript_text:'خارش', keywords:[]}}` |
| **Test Steps** | Call submitVoice('case-1', blob, 'ur') |
| **Test Data** | Blob(['wav'], {type:'audio/wav'}); language='ur' |
| **Expected Output** | Returns data with transcript_id=7 |
| **Actual Output** | As expected |
| **Status** | ✅ PASS |

### TC-USC-010 — submitVoice: uses .wav extension for audio/wav blobs
| | |
|---|---|
| **Module** | Client / useScreening hook / submitVoice() |
| **Test Type** | Unit (Edge) |
| **Pre-conditions** | api.post mocked → success |
| **Test Steps** | Call submitVoice with audio/wav blob; inspect FormData entries |
| **Test Data** | Blob type=audio/wav |
| **Expected Output** | FormData 'audio' entry has name='recording.wav' |
| **Actual Output** | As expected |
| **Status** | ✅ PASS |

### TC-USC-011 — submitVoice: uses .webm extension for audio/webm blobs
| | |
|---|---|
| **Module** | Client / useScreening hook / submitVoice() |
| **Test Type** | Unit (Edge) |
| **Pre-conditions** | api.post mocked → success |
| **Test Steps** | Call submitVoice with audio/webm blob; inspect FormData |
| **Test Data** | Blob type=audio/webm |
| **Expected Output** | FormData 'audio' entry has name='recording.webm' |
| **Actual Output** | As expected |
| **Status** | ✅ PASS |

### TC-USC-012 — submitVoice: uses .ogg extension for audio/ogg blobs
| | |
|---|---|
| **Module** | Client / useScreening hook / submitVoice() |
| **Test Type** | Unit (Edge) |
| **Pre-conditions** | api.post mocked → success |
| **Test Steps** | Call submitVoice with audio/ogg blob; inspect FormData |
| **Test Data** | Blob type=audio/ogg |
| **Expected Output** | FormData 'audio' entry has name='recording.ogg' |
| **Actual Output** | As expected |
| **Status** | ✅ PASS |

### TC-USC-013 — submitVoice: submits language field even when audioBlob is null
| | |
|---|---|
| **Module** | Client / useScreening hook / submitVoice() |
| **Test Type** | Unit (Edge) |
| **Pre-conditions** | api.post mocked → success |
| **Test Steps** | Call submitVoice('case-1', null, 'en'); inspect FormData |
| **Test Data** | audioBlob=null; language='en' |
| **Expected Output** | FormData 'language' entry = 'en' |
| **Actual Output** | As expected |
| **Status** | ✅ PASS |

### TC-USC-014 — submitVoice: sets error and re-throws on failure
| | |
|---|---|
| **Module** | Client / useScreening hook / submitVoice() |
| **Test Type** | Unit |
| **Pre-conditions** | api.post rejects with error 'Voice processing failed' |
| **Test Steps** | Call submitVoice() and catch |
| **Test Data** | audioBlob=null; language='ur' |
| **Expected Output** | hook.error='Voice processing failed' |
| **Actual Output** | As expected |
| **Status** | ✅ PASS |

### TC-USC-015 — runInference: posts to inference endpoint and returns prediction
| | |
|---|---|
| **Module** | Client / useScreening hook / runInference() |
| **Test Type** | Unit |
| **Pre-conditions** | api.post mocked → `{data: {prediction_id:55, top_condition:'Eczema', confidence_score:0.87}}` |
| **Test Steps** | Call runInference('case-1') |
| **Test Data** | caseId='case-1' |
| **Expected Output** | Returns data with top_condition='Eczema'; api.post called with '/screening/case-1/inference' |
| **Actual Output** | As expected |
| **Status** | ✅ PASS |

### TC-USC-016 — runInference: sets error message on failure
| | |
|---|---|
| **Module** | Client / useScreening hook / runInference() |
| **Test Type** | Unit |
| **Pre-conditions** | api.post rejects with error 'Analysis failed' |
| **Test Steps** | Call runInference() and catch |
| **Test Data** | (none) |
| **Expected Output** | hook.error='Analysis failed' |
| **Actual Output** | As expected |
| **Status** | ✅ PASS |

### TC-USC-017 — getResults: fetches and stores results in state
| | |
|---|---|
| **Module** | Client / useScreening hook / getResults() |
| **Test Type** | Unit |
| **Pre-conditions** | api.get mocked → `{data: {case_id:'c1', top_condition:'Psoriasis', confidence_score:0.75}}` |
| **Test Steps** | Call getResults('c1') |
| **Test Data** | caseId='c1' |
| **Expected Output** | Returns mockResult; hook.results=mockResult |
| **Actual Output** | As expected |
| **Status** | ✅ PASS |

### TC-USC-018 — getResults: sets error on failure
| | |
|---|---|
| **Module** | Client / useScreening hook / getResults() |
| **Test Type** | Unit |
| **Pre-conditions** | api.get rejects with error 'Failed to load results' |
| **Test Steps** | Call getResults() and catch |
| **Test Data** | (none) |
| **Expected Output** | hook.error='Failed to load results'; hook.results=null |
| **Actual Output** | As expected |
| **Status** | ✅ PASS |

### TC-USC-019 — getHistory: fetches case history list
| | |
|---|---|
| **Module** | Client / useScreening hook / getHistory() |
| **Test Type** | Unit |
| **Pre-conditions** | api.get mocked → `{data: [{case_id:'c1'}, {case_id:'c2'}]}` |
| **Test Steps** | Call getHistory() |
| **Test Data** | (none — GET /screening/history/list) |
| **Expected Output** | Returns array of 2 cases; api.get called with '/screening/history/list' |
| **Actual Output** | As expected |
| **Status** | ✅ PASS |

### TC-USC-020 — getHistory: sets error on failure
| | |
|---|---|
| **Module** | Client / useScreening hook / getHistory() |
| **Test Type** | Unit |
| **Pre-conditions** | api.get rejects with error 'Failed to load history' |
| **Test Steps** | Call getHistory() and catch |
| **Test Data** | (none) |
| **Expected Output** | hook.error='Failed to load history' |
| **Actual Output** | As expected |
| **Status** | ✅ PASS |

### TC-USC-021 — reset: clears caseId, results, and error
| | |
|---|---|
| **Module** | Client / useScreening hook / reset() |
| **Test Type** | Unit |
| **Pre-conditions** | createCase() and getResults() called first to populate state |
| **Test Steps** | Call reset() inside act() |
| **Test Data** | (pre-populated state: caseId='c99', results={top_condition:'Eczema'}) |
| **Expected Output** | hook.caseId=null; hook.results=null; hook.error=null |
| **Actual Output** | As expected |
| **Status** | ✅ PASS |

---

## 5. useVoiceRecorder Hook — `client/src/__tests__/useVoiceRecorder.test.jsx`

### TC-UVR-001 — Initial state: correct defaults before any interaction
| | |
|---|---|
| **Module** | Client / useVoiceRecorder hook |
| **Test Type** | Unit |
| **Pre-conditions** | Hook rendered fresh; navigator.mediaDevices.getUserMedia shimmed |
| **Test Steps** | renderHook useVoiceRecorder; read initial state |
| **Test Data** | (none) |
| **Expected Output** | isRecording=false; audioBlob=null; duration=0; error=null |
| **Actual Output** | As expected |
| **Status** | ✅ PASS |

### TC-UVR-002 — startRecording: sets isRecording=true after mic access granted
| | |
|---|---|
| **Module** | Client / useVoiceRecorder hook / startRecording() |
| **Test Type** | Unit |
| **Pre-conditions** | getUserMedia resolves with mock stream |
| **Test Steps** | await startRecording() inside act() |
| **Test Data** | (none) |
| **Expected Output** | isRecording=true; error=null |
| **Actual Output** | As expected |
| **Status** | ✅ PASS |

### TC-UVR-003 — startRecording: requests microphone with audio:true
| | |
|---|---|
| **Module** | Client / useVoiceRecorder hook / startRecording() |
| **Test Type** | Unit (Contract) |
| **Pre-conditions** | getUserMedia mocked |
| **Test Steps** | await startRecording(); inspect getUserMedia call args |
| **Test Data** | (none) |
| **Expected Output** | navigator.mediaDevices.getUserMedia called with {audio: true} |
| **Actual Output** | As expected |
| **Status** | ✅ PASS |

### TC-UVR-004 — startRecording: clears error from a previous failed attempt
| | |
|---|---|
| **Module** | Client / useVoiceRecorder hook / startRecording() |
| **Test Type** | Unit |
| **Pre-conditions** | First getUserMedia call rejects (NotAllowedError); second resolves with mock stream |
| **Test Steps** | startRecording() twice; verify error cleared on second success |
| **Test Data** | (none) |
| **Expected Output** | After first call: error is truthy. After second call: isRecording=true; error=null |
| **Actual Output** | As expected |
| **Status** | ✅ PASS |

### TC-UVR-005 — startRecording: sets error when microphone access is denied
| | |
|---|---|
| **Module** | Client / useVoiceRecorder hook / startRecording() |
| **Test Type** | Unit |
| **Pre-conditions** | getUserMedia rejects with error.name='NotAllowedError' |
| **Test Steps** | await startRecording() inside act() |
| **Test Data** | (none) |
| **Expected Output** | isRecording=false; error matches /microphone access denied/i |
| **Actual Output** | As expected |
| **Status** | ✅ PASS |

### TC-UVR-006 — startRecording: sets error on generic getUserMedia error
| | |
|---|---|
| **Module** | Client / useVoiceRecorder hook / startRecording() |
| **Test Type** | Unit |
| **Pre-conditions** | getUserMedia rejects with Error('Hardware unavailable') |
| **Test Steps** | await startRecording() inside act() |
| **Test Data** | (none) |
| **Expected Output** | error is truthy; isRecording=false |
| **Actual Output** | As expected |
| **Status** | ✅ PASS |

### TC-UVR-007 — stopRecording: sets isRecording=false immediately
| | |
|---|---|
| **Module** | Client / useVoiceRecorder hook / stopRecording() |
| **Test Type** | Unit |
| **Pre-conditions** | startRecording() called first; isRecording=true |
| **Test Steps** | stopRecording(); drain microtask queue via setTimeout(r,0) |
| **Test Data** | (none) |
| **Expected Output** | isRecording=false |
| **Actual Output** | As expected |
| **Status** | ✅ PASS |

### TC-UVR-008 — stopRecording: produces a non-null Blob after stopping
| | |
|---|---|
| **Module** | Client / useVoiceRecorder hook / stopRecording() |
| **Test Type** | Unit |
| **Pre-conditions** | startRecording() called first; WAV conversion pipeline shimmed |
| **Test Steps** | stopRecording(); drain microtask queue |
| **Test Data** | (none) |
| **Expected Output** | audioBlob instanceof Blob |
| **Actual Output** | As expected |
| **Status** | ✅ PASS |

### TC-UVR-009 — stopRecording: no-op when not currently recording
| | |
|---|---|
| **Module** | Client / useVoiceRecorder hook / stopRecording() |
| **Test Type** | Unit (Edge) |
| **Pre-conditions** | Hook in initial state (never started) |
| **Test Steps** | stopRecording() without prior startRecording() |
| **Test Data** | (none) |
| **Expected Output** | Does not throw; isRecording remains false |
| **Actual Output** | As expected |
| **Status** | ✅ PASS |

### TC-UVR-010 — clearRecording: resets audioBlob and duration to initial values
| | |
|---|---|
| **Module** | Client / useVoiceRecorder hook / clearRecording() |
| **Test Type** | Unit |
| **Pre-conditions** | startRecording() then stopRecording() called first (audioBlob populated) |
| **Test Steps** | clearRecording() inside act() |
| **Test Data** | (none) |
| **Expected Output** | audioBlob=null; duration=0 |
| **Actual Output** | As expected |
| **Status** | ✅ PASS |

### TC-UVR-011 — clearRecording: safe to call when nothing was recorded
| | |
|---|---|
| **Module** | Client / useVoiceRecorder hook / clearRecording() |
| **Test Type** | Unit (Edge) |
| **Pre-conditions** | Hook in initial state |
| **Test Steps** | clearRecording() inside act() |
| **Test Data** | (none) |
| **Expected Output** | Does not throw; audioBlob=null; duration=0 |
| **Actual Output** | As expected |
| **Status** | ✅ PASS |

### TC-UVR-012 — Duration timer: increments duration every second while recording
| | |
|---|---|
| **Module** | Client / useVoiceRecorder hook / duration |
| **Test Type** | Unit |
| **Pre-conditions** | vi.useFakeTimers scoped to setInterval/clearInterval/Date only (NOT setTimeout) |
| **Test Steps** | startRecording(); advanceTimersByTime(3000) |
| **Test Data** | (none) |
| **Expected Output** | duration >= 3 |
| **Actual Output** | As expected |
| **Status** | ✅ PASS |

### TC-UVR-013 — Duration timer: auto-stops when maxDuration is reached
| | |
|---|---|
| **Module** | Client / useVoiceRecorder hook |
| **Test Type** | Unit |
| **Pre-conditions** | Fake timers; hook instantiated with maxDuration=5000 |
| **Test Steps** | startRecording(); advanceTimersByTime(6000) |
| **Test Data** | maxDuration=5000ms |
| **Expected Output** | isRecording=false after max duration elapsed |
| **Actual Output** | As expected |
| **Status** | ✅ PASS |

### TC-UVR-014 — Duration timer: does not increment after recording is stopped
| | |
|---|---|
| **Module** | Client / useVoiceRecorder hook / duration |
| **Test Type** | Unit |
| **Pre-conditions** | Fake timers |
| **Test Steps** | startRecording(); advanceTimersByTime(2000); stopRecording(); advanceTimersByTime(5000) |
| **Test Data** | (none) |
| **Expected Output** | duration after extra 5000ms = duration at stop point (timer cleared) |
| **Actual Output** | As expected |
| **Status** | ✅ PASS |

### TC-UVR-015 — WAV conversion fallback: falls back to raw blob when decodeAudioData rejects
| | |
|---|---|
| **Module** | Client / useVoiceRecorder hook / WAV conversion |
| **Test Type** | Unit (Edge) |
| **Pre-conditions** | global.AudioContext replaced with stub that always rejects decodeAudioData |
| **Test Steps** | startRecording(); stopRecording(); drain microtask queue |
| **Test Data** | (none) |
| **Expected Output** | If audioBlob is not null, it is instanceof Blob (raw compressed blob used as fallback) |
| **Actual Output** | As expected |
| **Status** | ✅ PASS |

---

## 6. Image Validation — `client/src/__tests__/imageValidation.test.js`

### TC-IVL-001 — validateImageFile: accepts valid JPEG within size limit
| | |
|---|---|
| **Module** | Client / imageValidation / validateImageFile() |
| **Test Type** | Unit |
| **Pre-conditions** | File.size overridden to 1MB via Object.defineProperty |
| **Test Steps** | validateImageFile(file) |
| **Test Data** | File('data', 'skin.jpg', {type:'image/jpeg'}); size=1MB |
| **Expected Output** | valid=true; errors.length=0 |
| **Actual Output** | As expected |
| **Status** | ✅ PASS |

### TC-IVL-002 — validateImageFile: accepts valid PNG within size limit
| | |
|---|---|
| **Module** | Client / imageValidation / validateImageFile() |
| **Test Type** | Unit |
| **Pre-conditions** | File.size=500KB |
| **Test Steps** | validateImageFile(file) |
| **Test Data** | File('data', 'skin.png', {type:'image/png'}); size=500KB |
| **Expected Output** | valid=true; errors.length=0 |
| **Actual Output** | As expected |
| **Status** | ✅ PASS |

### TC-IVL-003 — validateImageFile: accepts file at exactly the 10 MB size limit
| | |
|---|---|
| **Module** | Client / imageValidation / validateImageFile() |
| **Test Type** | Unit (Boundary) |
| **Pre-conditions** | File.size=10*1024*1024 exactly |
| **Test Steps** | validateImageFile(file) |
| **Test Data** | JPEG; size=10485760 bytes |
| **Expected Output** | valid=true |
| **Actual Output** | As expected |
| **Status** | ✅ PASS |

### TC-IVL-004 — validateImageFile: rejects GIF with correct error message
| | |
|---|---|
| **Module** | Client / imageValidation / validateImageFile() |
| **Test Type** | Unit |
| **Pre-conditions** | None |
| **Test Steps** | validateImageFile(gif file) |
| **Test Data** | File('gif', 'anim.gif', {type:'image/gif'}) |
| **Expected Output** | valid=false; errors[0] matches /jpeg and png/i |
| **Actual Output** | As expected |
| **Status** | ✅ PASS |

### TC-IVL-005 — validateImageFile: rejects PDF
| | |
|---|---|
| **Module** | Client / imageValidation / validateImageFile() |
| **Test Type** | Unit |
| **Pre-conditions** | None |
| **Test Steps** | validateImageFile(pdf file) |
| **Test Data** | File('%PDF', 'doc.pdf', {type:'application/pdf'}) |
| **Expected Output** | valid=false; errors.length=1 |
| **Actual Output** | As expected |
| **Status** | ✅ PASS |

### TC-IVL-006 — validateImageFile: rejects file over 10 MB
| | |
|---|---|
| **Module** | Client / imageValidation / validateImageFile() |
| **Test Type** | Unit (Boundary) |
| **Pre-conditions** | File.size=10*1024*1024+1 (one byte over limit) |
| **Test Steps** | validateImageFile(oversized file) |
| **Test Data** | JPEG; size=10485761 bytes |
| **Expected Output** | valid=false; errors[0] matches /under 10mb/i |
| **Actual Output** | As expected |
| **Status** | ✅ PASS |

### TC-IVL-007 — validateImageFile: accumulates both errors for wrong type AND over size
| | |
|---|---|
| **Module** | Client / imageValidation / validateImageFile() |
| **Test Type** | Unit (Edge) |
| **Pre-conditions** | File is GIF (wrong type) AND 20MB (over size) |
| **Test Steps** | validateImageFile(file) |
| **Test Data** | File('data', 'big.gif', {type:'image/gif'}); size=20MB |
| **Expected Output** | valid=false; errors.length=2 |
| **Actual Output** | As expected |
| **Status** | ✅ PASS |

### TC-IVL-008 — validateImageFile: rejects file with empty MIME type
| | |
|---|---|
| **Module** | Client / imageValidation / validateImageFile() |
| **Test Type** | Unit (Edge) |
| **Pre-conditions** | None |
| **Test Steps** | validateImageFile(file with type='') |
| **Test Data** | File('data', 'noext', {type:''}) |
| **Expected Output** | valid=false |
| **Actual Output** | As expected |
| **Status** | ✅ PASS |

### TC-IVL-009 — validateImageDimensions: resolves valid for 400×400 image
| | |
|---|---|
| **Module** | Client / imageValidation / validateImageDimensions() |
| **Test Type** | Unit |
| **Pre-conditions** | global.Image mocked to fire onload with width=400, height=400 |
| **Test Steps** | await validateImageDimensions(file) |
| **Test Data** | JPEG file |
| **Expected Output** | valid=true; errors.length=0; width=400; height=400 |
| **Actual Output** | As expected |
| **Status** | ✅ PASS |

### TC-IVL-010 — validateImageDimensions: resolves valid at exactly 300×300 (minimum)
| | |
|---|---|
| **Module** | Client / imageValidation / validateImageDimensions() |
| **Test Type** | Unit (Boundary) |
| **Pre-conditions** | global.Image mocked → width=300, height=300 |
| **Test Steps** | await validateImageDimensions(file) |
| **Test Data** | JPEG file |
| **Expected Output** | valid=true |
| **Actual Output** | As expected |
| **Status** | ✅ PASS |

### TC-IVL-011 — validateImageDimensions: rejects image below 300×300
| | |
|---|---|
| **Module** | Client / imageValidation / validateImageDimensions() |
| **Test Type** | Unit |
| **Pre-conditions** | global.Image mocked → width=200, height=150 |
| **Test Steps** | await validateImageDimensions(file) |
| **Test Data** | Small JPEG |
| **Expected Output** | valid=false; errors[0] contains '300', '200', and '150' |
| **Actual Output** | As expected |
| **Status** | ✅ PASS |

### TC-IVL-012 — validateImageDimensions: rejects image wide but not tall enough
| | |
|---|---|
| **Module** | Client / imageValidation / validateImageDimensions() |
| **Test Type** | Unit |
| **Pre-conditions** | global.Image mocked → width=800, height=100 |
| **Test Steps** | await validateImageDimensions(file) |
| **Test Data** | Wide but short JPEG |
| **Expected Output** | valid=false |
| **Actual Output** | As expected |
| **Status** | ✅ PASS |

### TC-IVL-013 — validateImageDimensions: resolves invalid when image cannot be loaded
| | |
|---|---|
| **Module** | Client / imageValidation / validateImageDimensions() |
| **Test Type** | Unit |
| **Pre-conditions** | global.Image mocked to fire onerror (corrupt file simulation) |
| **Test Steps** | await validateImageDimensions(corrupt file) |
| **Test Data** | File('bad data', 'corrupt.jpg', {type:'image/jpeg'}) |
| **Expected Output** | valid=false; errors[0] matches /could not read/i |
| **Actual Output** | As expected |
| **Status** | ✅ PASS |

### TC-IVL-014 — validateImageDimensions: 299×300 fails on width only
| | |
|---|---|
| **Module** | Client / imageValidation / validateImageDimensions() |
| **Test Type** | Unit (Boundary) |
| **Pre-conditions** | global.Image mocked → width=299, height=300 |
| **Test Steps** | await validateImageDimensions(file) |
| **Test Data** | JPEG (width one pixel below minimum) |
| **Expected Output** | valid=false |
| **Actual Output** | As expected |
| **Status** | ✅ PASS |

### TC-IVL-015 — getConfidenceLevel: returns 'high' for score >= 0.8
| | |
|---|---|
| **Module** | Client / imageValidation / getConfidenceLevel() |
| **Test Type** | Unit |
| **Pre-conditions** | None |
| **Test Steps** | getConfidenceLevel(0.8); getConfidenceLevel(0.95); getConfidenceLevel(1.0) |
| **Test Data** | scores: 0.8, 0.95, 1.0 |
| **Expected Output** | 'high' for all three |
| **Actual Output** | As expected |
| **Status** | ✅ PASS |

### TC-IVL-016 — getConfidenceLevel: returns 'medium' for 0.6 <= score < 0.8
| | |
|---|---|
| **Module** | Client / imageValidation / getConfidenceLevel() |
| **Test Type** | Unit |
| **Pre-conditions** | None |
| **Test Steps** | getConfidenceLevel(0.6); getConfidenceLevel(0.7); getConfidenceLevel(0.79) |
| **Test Data** | scores: 0.6, 0.7, 0.79 |
| **Expected Output** | 'medium' for all three |
| **Actual Output** | As expected |
| **Status** | ✅ PASS |

### TC-IVL-017 — getConfidenceLevel: returns 'low' for score < 0.6
| | |
|---|---|
| **Module** | Client / imageValidation / getConfidenceLevel() |
| **Test Type** | Unit |
| **Pre-conditions** | None |
| **Test Steps** | getConfidenceLevel(0.0); getConfidenceLevel(0.59); getConfidenceLevel(0.3) |
| **Test Data** | scores: 0.0, 0.59, 0.3 |
| **Expected Output** | 'low' for all three |
| **Actual Output** | As expected |
| **Status** | ✅ PASS |

### TC-IVL-018 — getConfidenceLevel: exactly 0.8 is 'high' (inclusive boundary)
| | |
|---|---|
| **Module** | Client / imageValidation / getConfidenceLevel() |
| **Test Type** | Unit (Boundary) |
| **Pre-conditions** | None |
| **Test Steps** | getConfidenceLevel(0.8) |
| **Test Data** | score=0.8 |
| **Expected Output** | 'high' |
| **Actual Output** | As expected |
| **Status** | ✅ PASS |

### TC-IVL-019 — getConfidenceLevel: exactly 0.6 is 'medium' (inclusive boundary)
| | |
|---|---|
| **Module** | Client / imageValidation / getConfidenceLevel() |
| **Test Type** | Unit (Boundary) |
| **Pre-conditions** | None |
| **Test Steps** | getConfidenceLevel(0.6) |
| **Test Data** | score=0.6 |
| **Expected Output** | 'medium' |
| **Actual Output** | As expected |
| **Status** | ✅ PASS |

### TC-IVL-020 — getConfidenceColor: returns #16a34a for high confidence
| | |
|---|---|
| **Module** | Client / imageValidation / getConfidenceColor() |
| **Test Type** | Unit |
| **Pre-conditions** | None |
| **Test Steps** | getConfidenceColor(0.8); getConfidenceColor(1.0) |
| **Test Data** | scores: 0.8, 1.0 |
| **Expected Output** | '#16a34a' (green) for both |
| **Actual Output** | As expected |
| **Status** | ✅ PASS |

### TC-IVL-021 — getConfidenceColor: returns #d97706 for medium confidence
| | |
|---|---|
| **Module** | Client / imageValidation / getConfidenceColor() |
| **Test Type** | Unit |
| **Pre-conditions** | None |
| **Test Steps** | getConfidenceColor(0.6); getConfidenceColor(0.75); getConfidenceColor(0.79) |
| **Test Data** | scores: 0.6, 0.75, 0.79 |
| **Expected Output** | '#d97706' (amber) for all three |
| **Actual Output** | As expected |
| **Status** | ✅ PASS |

### TC-IVL-022 — getConfidenceColor: returns #dc2626 for low confidence
| | |
|---|---|
| **Module** | Client / imageValidation / getConfidenceColor() |
| **Test Type** | Unit |
| **Pre-conditions** | None |
| **Test Steps** | getConfidenceColor(0.0); getConfidenceColor(0.59) |
| **Test Data** | scores: 0.0, 0.59 |
| **Expected Output** | '#dc2626' (red) for both |
| **Actual Output** | As expected |
| **Status** | ✅ PASS |

### TC-IVL-023 — getConfidenceColor: boundary values match expected colors
| | |
|---|---|
| **Module** | Client / imageValidation / getConfidenceColor() |
| **Test Type** | Unit (Boundary) |
| **Pre-conditions** | None |
| **Test Steps** | getConfidenceColor(0.8); getConfidenceColor(0.6) |
| **Test Data** | scores: 0.8, 0.6 |
| **Expected Output** | 0.8 → '#16a34a'; 0.6 → '#d97706' |
| **Actual Output** | As expected |
| **Status** | ✅ PASS |

---

## 7. Inference Health & Predict — `inference/tests/test_predict.py`

### TC-PYP-001 — GET /health returns 200
| | |
|---|---|
| **Module** | Inference / GET /health |
| **Test Type** | Integration |
| **Pre-conditions** | FastAPI TestClient; model loaded with random weights (MODEL_PATH nonexistent) |
| **Test Steps** | GET /health |
| **Test Data** | (none) |
| **Expected Output** | HTTP 200 |
| **Actual Output** | As expected |
| **Status** | ✅ PASS |

### TC-PYP-002 — GET /health contains expected keys
| | |
|---|---|
| **Module** | Inference / GET /health |
| **Test Type** | Integration |
| **Pre-conditions** | Same as TC-PYP-001 |
| **Test Steps** | GET /health; parse JSON |
| **Test Data** | (none) |
| **Expected Output** | body contains keys: status, model, device, classes |
| **Actual Output** | As expected |
| **Status** | ✅ PASS |

### TC-PYP-003 — GET /health status field is 'ok'
| | |
|---|---|
| **Module** | Inference / GET /health |
| **Test Type** | Integration |
| **Pre-conditions** | Same |
| **Test Steps** | GET /health; read body['status'] |
| **Test Data** | (none) |
| **Expected Output** | body['status'] == 'ok' |
| **Actual Output** | As expected |
| **Status** | ✅ PASS |

### TC-PYP-004 — GET /health classes contains all seven skin conditions
| | |
|---|---|
| **Module** | Inference / GET /health |
| **Test Type** | Integration |
| **Pre-conditions** | Same |
| **Test Steps** | GET /health; read body['classes'] |
| **Test Data** | (none) |
| **Expected Output** | set(classes) == {Vitiligo, Melasma, Psoriasis, Eczema, Tinea, Contact Dermatitis, Seborrheic Dermatitis} |
| **Actual Output** | As expected |
| **Status** | ✅ PASS |

### TC-PYP-005 — GET /health shows ASR model not loaded
| | |
|---|---|
| **Module** | Inference / GET /health |
| **Test Type** | Integration |
| **Pre-conditions** | ASR_MODEL_PATH set to nonexistent path in conftest.py; asr_pipe is None |
| **Test Steps** | GET /health; read body['asr_model'] |
| **Test Data** | (none) |
| **Expected Output** | 'not loaded' in body['asr_model'] |
| **Actual Output** | As expected |
| **Status** | ✅ PASS |

### TC-PYP-006 — POST /predict returns 200 for valid PNG
| | |
|---|---|
| **Module** | Inference / POST /predict |
| **Test Type** | Integration |
| **Pre-conditions** | png_bytes fixture (32×32 solid-colour PNG); model with random weights |
| **Test Steps** | POST /predict with PNG image |
| **Test Data** | image=skin.png; content-type=image/png |
| **Expected Output** | HTTP 200 |
| **Actual Output** | As expected |
| **Status** | ✅ PASS |

### TC-PYP-007 — POST /predict returns 200 for valid JPEG
| | |
|---|---|
| **Module** | Inference / POST /predict |
| **Test Type** | Integration |
| **Pre-conditions** | jpeg_bytes fixture (32×32 JPEG) |
| **Test Steps** | POST /predict with JPEG image |
| **Test Data** | image=skin.jpg; content-type=image/jpeg |
| **Expected Output** | HTTP 200 |
| **Actual Output** | As expected |
| **Status** | ✅ PASS |

### TC-PYP-008 — POST /predict response has all required keys
| | |
|---|---|
| **Module** | Inference / POST /predict |
| **Test Type** | Integration |
| **Pre-conditions** | png_bytes fixture |
| **Test Steps** | POST /predict; parse JSON response |
| **Test Data** | PNG image |
| **Expected Output** | body keys include: model_version, top_condition, confidence_score, all_scores, heatmap_path, inference_time_ms |
| **Actual Output** | As expected |
| **Status** | ✅ PASS |

### TC-PYP-009 — POST /predict top_condition is one of the seven valid classes
| | |
|---|---|
| **Module** | Inference / POST /predict |
| **Test Type** | Integration |
| **Pre-conditions** | png_bytes; random model weights |
| **Test Steps** | POST /predict; read body['top_condition'] |
| **Test Data** | PNG image |
| **Expected Output** | top_condition in {Vitiligo, Melasma, Psoriasis, Eczema, Tinea, Contact Dermatitis, Seborrheic Dermatitis} |
| **Actual Output** | As expected |
| **Status** | ✅ PASS |

### TC-PYP-010 — POST /predict confidence_score is between 0 and 1
| | |
|---|---|
| **Module** | Inference / POST /predict |
| **Test Type** | Integration |
| **Pre-conditions** | png_bytes |
| **Test Steps** | POST /predict; read body['confidence_score'] |
| **Test Data** | PNG image |
| **Expected Output** | 0.0 <= confidence_score <= 1.0 |
| **Actual Output** | As expected |
| **Status** | ✅ PASS |

### TC-PYP-011 — POST /predict all_scores contains all seven classes
| | |
|---|---|
| **Module** | Inference / POST /predict |
| **Test Type** | Integration |
| **Pre-conditions** | png_bytes |
| **Test Steps** | POST /predict; read body['all_scores'] keys |
| **Test Data** | PNG image |
| **Expected Output** | set(all_scores.keys()) == all seven class names |
| **Actual Output** | As expected |
| **Status** | ✅ PASS |

### TC-PYP-012 — POST /predict all_scores sum approximately to 1.0 (softmax property)
| | |
|---|---|
| **Module** | Inference / POST /predict |
| **Test Type** | Integration |
| **Pre-conditions** | png_bytes; softmax applied in model output layer |
| **Test Steps** | POST /predict; sum all_scores values |
| **Test Data** | PNG image |
| **Expected Output** | abs(sum(all_scores.values()) − 1.0) < 0.01 |
| **Actual Output** | As expected |
| **Status** | ✅ PASS |

### TC-PYP-013 — POST /predict heatmap file is written to disk
| | |
|---|---|
| **Module** | Inference / POST /predict |
| **Test Type** | Integration |
| **Pre-conditions** | png_bytes; HEATMAP_DIR env var set to temp directory |
| **Test Steps** | POST /predict; read heatmap_path from response; check file exists |
| **Test Data** | PNG image |
| **Expected Output** | heatmap_path ends with '.png'; file exists at HEATMAP_DIR/heatmap_path |
| **Actual Output** | As expected |
| **Status** | ✅ PASS |

### TC-PYP-014 — POST /predict inference_time_ms is a positive integer
| | |
|---|---|
| **Module** | Inference / POST /predict |
| **Test Type** | Integration |
| **Pre-conditions** | png_bytes |
| **Test Steps** | POST /predict; read body['inference_time_ms'] |
| **Test Data** | PNG image |
| **Expected Output** | isinstance(inference_time_ms, int) and inference_time_ms > 0 |
| **Actual Output** | As expected |
| **Status** | ✅ PASS |

### TC-PYP-015 — POST /predict model_version is a non-empty string
| | |
|---|---|
| **Module** | Inference / POST /predict |
| **Test Type** | Integration |
| **Pre-conditions** | png_bytes |
| **Test Steps** | POST /predict; read body['model_version'] |
| **Test Data** | PNG image |
| **Expected Output** | isinstance(model_version, str) and len(model_version) > 0 |
| **Actual Output** | As expected |
| **Status** | ✅ PASS |

### TC-PYP-016 — POST /predict returns 400 for non-image bytes
| | |
|---|---|
| **Module** | Inference / POST /predict |
| **Test Type** | Integration |
| **Pre-conditions** | None |
| **Test Steps** | POST /predict with plain text bytes |
| **Test Data** | b'hello world'; filename=notanimage.txt; content-type=text/plain |
| **Expected Output** | HTTP 400; 'error' in response body |
| **Actual Output** | As expected |
| **Status** | ✅ PASS |

### TC-PYP-017 — POST /predict returns 400 for empty bytes
| | |
|---|---|
| **Module** | Inference / POST /predict |
| **Test Type** | Integration |
| **Pre-conditions** | None |
| **Test Steps** | POST /predict with empty byte string |
| **Test Data** | b''; filename=empty.png; content-type=image/png |
| **Expected Output** | HTTP 400 |
| **Actual Output** | As expected |
| **Status** | ✅ PASS |

### TC-PYP-018 — POST /predict returns 400 for truncated JPEG
| | |
|---|---|
| **Module** | Inference / POST /predict |
| **Test Type** | Integration |
| **Pre-conditions** | None |
| **Test Steps** | POST /predict with only JPEG SOI marker (3 bytes) |
| **Test Data** | b'\xff\xd8\xff'; filename=bad.jpg; content-type=image/jpeg |
| **Expected Output** | HTTP 400 |
| **Actual Output** | As expected |
| **Status** | ✅ PASS |

### TC-PYP-019 — POST /predict large image (2048×2048) is resized and processed
| | |
|---|---|
| **Module** | Inference / POST /predict |
| **Test Type** | Integration (Edge) |
| **Pre-conditions** | 2048×2048 solid-colour PNG created in-test with Pillow |
| **Test Steps** | POST /predict with large PNG |
| **Test Data** | 2048×2048 RGB PNG |
| **Expected Output** | HTTP 200 (preprocessing pipeline resizes to 224×224 before model inference) |
| **Actual Output** | As expected |
| **Status** | ✅ PASS |

---

## 8. Inference Transcribe — `inference/tests/test_transcribe.py`

### TC-PYT-001 — POST /transcribe returns 503 with valid WAV (ASR not loaded)
| | |
|---|---|
| **Module** | Inference / POST /transcribe |
| **Test Type** | Integration |
| **Pre-conditions** | ASR_MODEL_PATH points to nonexistent directory; asr_pipe=None at startup |
| **Test Steps** | POST /transcribe with valid WAV |
| **Test Data** | wav_bytes fixture; filename=rec.wav; content-type=audio/wav |
| **Expected Output** | HTTP 503 |
| **Actual Output** | As expected |
| **Status** | ✅ PASS |

### TC-PYT-002 — POST /transcribe response contains 'error' key
| | |
|---|---|
| **Module** | Inference / POST /transcribe |
| **Test Type** | Integration |
| **Pre-conditions** | Same |
| **Test Steps** | POST /transcribe; parse JSON |
| **Test Data** | wav_bytes |
| **Expected Output** | 'error' in body |
| **Actual Output** | As expected |
| **Status** | ✅ PASS |

### TC-PYT-003 — POST /transcribe error message mentions model not loaded
| | |
|---|---|
| **Module** | Inference / POST /transcribe |
| **Test Type** | Integration |
| **Pre-conditions** | Same |
| **Test Steps** | POST /transcribe; read body['error'] |
| **Test Data** | wav_bytes |
| **Expected Output** | 'not loaded' in error.lower() OR 'asr' in error.lower() |
| **Actual Output** | As expected |
| **Status** | ✅ PASS |

### TC-PYT-004 — POST /transcribe returns 503 with webm audio
| | |
|---|---|
| **Module** | Inference / POST /transcribe |
| **Test Type** | Integration |
| **Pre-conditions** | Same |
| **Test Steps** | POST /transcribe with fake webm bytes |
| **Test Data** | b'fake webm data'; content-type=audio/webm |
| **Expected Output** | HTTP 503 |
| **Actual Output** | As expected |
| **Status** | ✅ PASS |

### TC-PYT-005 — POST /transcribe returns 503 with mp4 audio
| | |
|---|---|
| **Module** | Inference / POST /transcribe |
| **Test Type** | Integration |
| **Pre-conditions** | Same |
| **Test Steps** | POST /transcribe with fake mp4 bytes |
| **Test Data** | b'fake mp4 data'; content-type=audio/mp4 |
| **Expected Output** | HTTP 503 |
| **Actual Output** | As expected |
| **Status** | ✅ PASS |

### TC-PYT-006 — POST /transcribe returns 400 or 503 for empty audio file
| | |
|---|---|
| **Module** | Inference / POST /transcribe |
| **Test Type** | Integration |
| **Pre-conditions** | Empty file validation may fire before ASR check depending on guard order |
| **Test Steps** | POST /transcribe with empty byte string |
| **Test Data** | b''; filename=empty.wav; content-type=audio/wav |
| **Expected Output** | HTTP 400 or 503 (either is acceptable) |
| **Actual Output** | As expected |
| **Status** | ✅ PASS |

### TC-PYT-007 — POST /transcribe response is JSON
| | |
|---|---|
| **Module** | Inference / POST /transcribe |
| **Test Type** | Integration |
| **Pre-conditions** | Same |
| **Test Steps** | POST /transcribe; check Content-Type header |
| **Test Data** | wav_bytes |
| **Expected Output** | content-type starts with 'application/json' |
| **Actual Output** | As expected |
| **Status** | ✅ PASS |

### TC-PYT-008 — POST /transcribe 255-character filename still returns 503
| | |
|---|---|
| **Module** | Inference / POST /transcribe |
| **Test Type** | Integration (Edge) |
| **Pre-conditions** | Same |
| **Test Steps** | POST /transcribe with filename of 255 'a' characters + '.wav' |
| **Test Data** | wav_bytes; filename='aaa...aaa.wav' (255 chars) |
| **Expected Output** | HTTP 503 (server does not crash on long filename) |
| **Actual Output** | As expected |
| **Status** | ✅ PASS |

### TC-PYT-009 — POST /transcribe no filename still returns 503 or 422
| | |
|---|---|
| **Module** | Inference / POST /transcribe |
| **Test Type** | Integration (Edge) |
| **Pre-conditions** | FastAPI may fire its own 422 validator when filename is None |
| **Test Steps** | POST /transcribe with filename=None |
| **Test Data** | wav_bytes; filename=None |
| **Expected Output** | HTTP 503 or 422 |
| **Actual Output** | As expected |
| **Status** | ✅ PASS |

---

## 9. Inference Heatmap — `inference/tests/test_heatmap.py`

### TC-PYH-001 — GET /heatmaps/{filename} returns 200 for existing heatmap
| | |
|---|---|
| **Module** | Inference / GET /heatmaps/{filename} |
| **Test Type** | Integration |
| **Pre-conditions** | Real heatmap file generated by calling POST /predict first; filename from response |
| **Test Steps** | GET /heatmaps/{filename} |
| **Test Data** | Valid filename from predict response |
| **Expected Output** | HTTP 200 |
| **Actual Output** | As expected |
| **Status** | ✅ PASS |

### TC-PYH-002 — GET /heatmaps/{filename} content-type is image/png
| | |
|---|---|
| **Module** | Inference / GET /heatmaps/{filename} |
| **Test Type** | Integration |
| **Pre-conditions** | Same |
| **Test Steps** | GET /heatmaps/{filename}; read Content-Type header |
| **Test Data** | Valid filename |
| **Expected Output** | content-type starts with 'image/png' |
| **Actual Output** | As expected |
| **Status** | ✅ PASS |

### TC-PYH-003 — GET /heatmaps/{filename} response body is non-empty
| | |
|---|---|
| **Module** | Inference / GET /heatmaps/{filename} |
| **Test Type** | Integration |
| **Pre-conditions** | Same |
| **Test Steps** | GET /heatmaps/{filename}; check content length |
| **Test Data** | Valid filename |
| **Expected Output** | len(response.content) > 0 |
| **Actual Output** | As expected |
| **Status** | ✅ PASS |

### TC-PYH-004 — GET /heatmaps/{filename} has valid PNG byte signature
| | |
|---|---|
| **Module** | Inference / GET /heatmaps/{filename} |
| **Test Type** | Integration |
| **Pre-conditions** | Same |
| **Test Steps** | GET /heatmaps/{filename}; read first 8 bytes |
| **Test Data** | Valid filename |
| **Expected Output** | response.content[:8] == b'\x89PNG\r\n\x1a\n' |
| **Actual Output** | As expected |
| **Status** | ✅ PASS |

### TC-PYH-005 — GET /heatmaps/{filename} returns 404 for nonexistent filename
| | |
|---|---|
| **Module** | Inference / GET /heatmaps/{filename} |
| **Test Type** | Integration |
| **Pre-conditions** | None |
| **Test Steps** | GET /heatmaps/does_not_exist.png |
| **Test Data** | filename=does_not_exist.png |
| **Expected Output** | HTTP 404; 'error' in response body |
| **Actual Output** | As expected |
| **Status** | ✅ PASS |

### TC-PYH-006 — GET /heatmaps/{filename} returns 404 for random UUID filename
| | |
|---|---|
| **Module** | Inference / GET /heatmaps/{filename} |
| **Test Type** | Integration |
| **Pre-conditions** | None |
| **Test Steps** | GET /heatmaps/00000000-0000-0000-0000-000000000000.png |
| **Test Data** | filename=00000000-0000-0000-0000-000000000000.png |
| **Expected Output** | HTTP 404 |
| **Actual Output** | As expected |
| **Status** | ✅ PASS |

### TC-PYH-007 — GET /heatmaps/{filename} path traversal payload is blocked
| | |
|---|---|
| **Module** | Inference / GET /heatmaps/{filename} |
| **Test Type** | Integration (Security) |
| **Pre-conditions** | Server must sanitise filename to prevent directory traversal |
| **Test Steps** | GET /heatmaps/../../../etc/passwd |
| **Test Data** | Path traversal payload |
| **Expected Output** | HTTP 400, 404, or 422 — must NOT return 200 |
| **Actual Output** | As expected |
| **Status** | ✅ PASS |

### TC-PYH-008 — GET /heatmaps/{filename} URL-encoded absolute path is blocked
| | |
|---|---|
| **Module** | Inference / GET /heatmaps/{filename} |
| **Test Type** | Integration (Security) |
| **Pre-conditions** | None |
| **Test Steps** | GET /heatmaps/%2Fetc%2Fpasswd |
| **Test Data** | URL-encoded absolute path |
| **Expected Output** | HTTP 400, 404, or 422 — must NOT return 200 |
| **Actual Output** | As expected |
| **Status** | ✅ PASS |

### TC-PYH-009 — GET /heatmaps/{filename} filename with no extension returns 404
| | |
|---|---|
| **Module** | Inference / GET /heatmaps/{filename} |
| **Test Type** | Integration (Edge) |
| **Pre-conditions** | None |
| **Test Steps** | GET /heatmaps/noPngExtension |
| **Test Data** | filename=noPngExtension |
| **Expected Output** | HTTP 404 |
| **Actual Output** | As expected |
| **Status** | ✅ PASS |

### TC-PYH-010 — GET /heatmaps/{filename} empty filename segment returns 404/405/422
| | |
|---|---|
| **Module** | Inference / GET /heatmaps/{filename} |
| **Test Type** | Integration (Edge) |
| **Pre-conditions** | None |
| **Test Steps** | GET /heatmaps/ (trailing slash only) |
| **Test Data** | (none — empty path segment) |
| **Expected Output** | HTTP 404, 405, or 422 |
| **Actual Output** | As expected |
| **Status** | ✅ PASS |

---

## 10. Inference Utility Functions — `inference/tests/test_utils.py`

### TC-PYU-001 — load_audio_wav: returns float32 numpy array
| | |
|---|---|
| **Module** | Inference / load_audio_wav() |
| **Test Type** | Unit |
| **Pre-conditions** | Temporary 1-second silent WAV file created by _make_wav(16000) |
| **Test Steps** | audio = load_audio_wav(path) |
| **Test Data** | 16000-sample silent WAV at 16 kHz |
| **Expected Output** | audio.dtype == np.float32 |
| **Actual Output** | As expected |
| **Status** | ✅ PASS |

### TC-PYU-002 — load_audio_wav: correct sample count for 1-second clip
| | |
|---|---|
| **Module** | Inference / load_audio_wav() |
| **Test Type** | Unit |
| **Pre-conditions** | Same 16000-sample WAV |
| **Test Steps** | audio = load_audio_wav(path) |
| **Test Data** | 16000 samples at 16 kHz = 1 second |
| **Expected Output** | len(audio) == 16000 |
| **Actual Output** | As expected |
| **Status** | ✅ PASS |

### TC-PYU-003 — load_audio_wav: silent WAV decodes to all-zeros array
| | |
|---|---|
| **Module** | Inference / load_audio_wav() |
| **Test Type** | Unit |
| **Pre-conditions** | WAV with all-zero PCM samples |
| **Test Steps** | audio = load_audio_wav(path) |
| **Test Data** | Silent WAV (all 0x00 bytes in data chunk) |
| **Expected Output** | np.allclose(audio, 0.0) |
| **Actual Output** | As expected |
| **Status** | ✅ PASS |

### TC-PYU-004 — load_audio_wav: returns 1D array
| | |
|---|---|
| **Module** | Inference / load_audio_wav() |
| **Test Type** | Unit |
| **Pre-conditions** | 3200-sample mono WAV |
| **Test Steps** | audio = load_audio_wav(path) |
| **Test Data** | 3200-sample WAV |
| **Expected Output** | audio.ndim == 1 |
| **Actual Output** | As expected |
| **Status** | ✅ PASS |

### TC-PYU-005 — load_audio_wav: handles 0.1-second short clip (1600 samples)
| | |
|---|---|
| **Module** | Inference / load_audio_wav() |
| **Test Type** | Unit |
| **Pre-conditions** | 1600-sample WAV (0.1 second at 16 kHz) |
| **Test Steps** | audio = load_audio_wav(path) |
| **Test Data** | 1600-sample WAV |
| **Expected Output** | len(audio) == 1600 |
| **Actual Output** | As expected |
| **Status** | ✅ PASS |

### TC-PYU-006 — load_audio_wav: raises exception for nonexistent file
| | |
|---|---|
| **Module** | Inference / load_audio_wav() |
| **Test Type** | Unit |
| **Pre-conditions** | File path does not exist |
| **Test Steps** | load_audio_wav('/nonexistent/path/to/audio.wav') |
| **Test Data** | path='/nonexistent/path/to/audio.wav' |
| **Expected Output** | Raises any Exception |
| **Actual Output** | As expected |
| **Status** | ✅ PASS |

### TC-PYU-007 — GradCAM.generate: CAM output is 2D numpy array
| | |
|---|---|
| **Module** | Inference / GradCAM.generate() |
| **Test Type** | Unit |
| **Pre-conditions** | Model with random weights; 224×224 RGB test image tensor |
| **Test Steps** | cam, class_idx = GradCAM(model).generate(tensor) |
| **Test Data** | PIL Image(224×224, RGB=(128,64,32)) normalised to tensor |
| **Expected Output** | cam.ndim == 2 |
| **Actual Output** | As expected |
| **Status** | ✅ PASS |

### TC-PYU-008 — GradCAM.generate: CAM values are in [0, 1]
| | |
|---|---|
| **Module** | Inference / GradCAM.generate() |
| **Test Type** | Unit |
| **Pre-conditions** | Same |
| **Test Steps** | cam, _ = GradCAM(model).generate(tensor) |
| **Test Data** | PIL Image(224×224, RGB=(200,100,50)) |
| **Expected Output** | cam.min() >= 0.0 and cam.max() <= 1.0 |
| **Actual Output** | As expected |
| **Status** | ✅ PASS |

### TC-PYU-009 — GradCAM.generate: class_idx is within valid range
| | |
|---|---|
| **Module** | Inference / GradCAM.generate() |
| **Test Type** | Unit |
| **Pre-conditions** | Same; CLASS_NAMES has 7 entries |
| **Test Steps** | _, class_idx = GradCAM(model).generate(tensor) |
| **Test Data** | Black 224×224 image |
| **Expected Output** | 0 <= class_idx < len(CLASS_NAMES) |
| **Actual Output** | As expected |
| **Status** | ✅ PASS |

### TC-PYU-010 — GradCAM.generate: explicit class_idx parameter is respected
| | |
|---|---|
| **Module** | Inference / GradCAM.generate() |
| **Test Type** | Unit |
| **Pre-conditions** | Same |
| **Test Steps** | _, returned_idx = GradCAM(model).generate(tensor, class_idx=2) |
| **Test Data** | class_idx=2 passed explicitly |
| **Expected Output** | returned_idx == 2 |
| **Actual Output** | As expected |
| **Status** | ✅ PASS |

### TC-PYU-011 — create_heatmap_overlay: output is a numpy array
| | |
|---|---|
| **Module** | Inference / create_heatmap_overlay() |
| **Test Type** | Unit |
| **Pre-conditions** | PIL Image (100×100 RGB); random float32 CAM (14×14) |
| **Test Steps** | overlay = create_heatmap_overlay(img, cam) |
| **Test Data** | img=PIL(100×100, RGB=(100,150,200)); cam=np.random.rand(14,14) |
| **Expected Output** | isinstance(overlay, np.ndarray) |
| **Actual Output** | As expected |
| **Status** | ✅ PASS |

### TC-PYU-012 — create_heatmap_overlay: output has three channels
| | |
|---|---|
| **Module** | Inference / create_heatmap_overlay() |
| **Test Type** | Unit |
| **Pre-conditions** | Same |
| **Test Steps** | overlay = create_heatmap_overlay(img, cam) |
| **Test Data** | Same |
| **Expected Output** | overlay.ndim == 3 and overlay.shape[2] == 3 |
| **Actual Output** | As expected |
| **Status** | ✅ PASS |

### TC-PYU-013 — create_heatmap_overlay: output dimensions match IMG_SIZE
| | |
|---|---|
| **Module** | Inference / create_heatmap_overlay() |
| **Test Type** | Unit |
| **Pre-conditions** | IMG_SIZE imported from server.py |
| **Test Steps** | overlay = create_heatmap_overlay(img, cam) |
| **Test Data** | Same |
| **Expected Output** | overlay.shape[0] == IMG_SIZE and overlay.shape[1] == IMG_SIZE |
| **Actual Output** | As expected |
| **Status** | ✅ PASS |

### TC-PYU-014 — create_heatmap_overlay: output dtype is uint8
| | |
|---|---|
| **Module** | Inference / create_heatmap_overlay() |
| **Test Type** | Unit |
| **Pre-conditions** | Same |
| **Test Steps** | overlay = create_heatmap_overlay(img, cam) |
| **Test Data** | Same |
| **Expected Output** | overlay.dtype == np.uint8 |
| **Actual Output** | As expected |
| **Status** | ✅ PASS |

### TC-PYU-015 — create_heatmap_overlay: pixel values are in [0, 255]
| | |
|---|---|
| **Module** | Inference / create_heatmap_overlay() |
| **Test Type** | Unit |
| **Pre-conditions** | Same |
| **Test Steps** | overlay = create_heatmap_overlay(img, cam) |
| **Test Data** | Same |
| **Expected Output** | overlay.min() >= 0 and overlay.max() <= 255 |
| **Actual Output** | As expected |
| **Status** | ✅ PASS |

### TC-PYU-016 — create_heatmap_overlay: all-zero CAM produces valid overlay
| | |
|---|---|
| **Module** | Inference / create_heatmap_overlay() |
| **Test Type** | Unit (Edge) |
| **Pre-conditions** | CAM = np.zeros((7,7), dtype=np.float32); black 50×50 image |
| **Test Steps** | overlay = create_heatmap_overlay(img, cam) |
| **Test Data** | All-zero CAM |
| **Expected Output** | overlay.dtype == np.uint8 (no crash, valid output) |
| **Actual Output** | As expected |
| **Status** | ✅ PASS |

### TC-PYU-017 — create_heatmap_overlay: all-one CAM produces valid overlay
| | |
|---|---|
| **Module** | Inference / create_heatmap_overlay() |
| **Test Type** | Unit (Edge) |
| **Pre-conditions** | CAM = np.ones((7,7), dtype=np.float32); white 50×50 image |
| **Test Steps** | overlay = create_heatmap_overlay(img, cam) |
| **Test Data** | All-one CAM |
| **Expected Output** | overlay.dtype == np.uint8 (no crash, valid output) |
| **Actual Output** | As expected |
| **Status** | ✅ PASS |

---

*End of document — 193 test cases across 10 test files.*
