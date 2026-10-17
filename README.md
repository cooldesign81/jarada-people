# 자라다 People — JP 통합 HR 시스템

Firebase(Authentication + Firestore) 위에서 동작하는 정적 웹앱입니다. 빌드 과정 없이 GitHub Pages로 배포됩니다.

- 앱 주소: https://cooldesign81.github.io/jarada-people/
- 초기 설정 페이지: https://cooldesign81.github.io/jarada-people/setup.html

## 파일 구성

| 파일 | 역할 |
|---|---|
| `index.html` | 메인 앱 (로그인 → 대시보드 / 직원 / 직원 상세 / 조직 / 내 정보) |
| `setup.html` | 최초 관리자 등록용. 구글 로그인 후 UID 확인 → `roles` 문서 수동 생성 안내 |
| `js/firebase.js` | Firebase 설정·초기화 (Auth, Firestore, Storage) |
| `js/core.js` | 공용 상태·유틸 |
| `js/app.js` | 로그인, 목록, 일괄 등록, 조직 |
| `js/detail.js` | 직원 상세 (주민번호·개인정보·급여·서류 업로드·증명서·등록 링크) |
| `js/company.js` | 증명서용 회사 정보·직인 (jarada-hr 에서 가져옴) |
| `firestore.rules` | Firestore 보안 규칙 (콘솔에 붙여넣어 게시) |
| `storage.rules` | Cloud Storage 보안 규칙 (콘솔에 붙여넣어 게시) |

## 처음 설정하는 순서

1. **Firestore 규칙 게시** — Firebase 콘솔 → Firestore Database → *규칙* 탭에 `firestore.rules` 내용을 붙여넣고 **게시**.
2. **Storage 켜기 + 규칙 게시** — Storage → 시작하기(필요하면 요금제를 Blaze 로 업그레이드해야 할 수 있음) → *규칙* 탭에 `storage.rules` 붙여넣고 **게시**. 이 규칙은 Firestore 의 권한 문서를 참조하므로, 게시할 때 콘솔이 권한 부여를 물으면 허용합니다.
3. **로그인 방법** — Authentication → Sign-in method: `Google` 사용, 등록 링크용으로 `익명(Anonymous)` 도 사용 설정. 설정 → 승인된 도메인에 `cooldesign81.github.io` 추가.
4. **최초 관리자 등록** — `setup.html`에서 구글 로그인 → UID 복사 → Firestore `roles` 컬렉션에 문서 ID = UID 로 생성:
   - `level` = `super`
   - `orgId` = `hq`
   - `employeeId` = `emp_0001`
5. **앱 진입** — `index.html` 로 이동하면 본사(`orgs/hq`)가 자동 생성됩니다. *내 정보* 탭에서 본인 직원 정보를 등록합니다.
6. **조직(지점) 등록** — *조직* 탭에서 평촌원·반포원·대치원 등을 추가합니다.
7. **직원 등록** — *직원* 탭에서 한 명씩 등록하거나 **일괄 등록**(엑셀·구글시트 붙여넣기 / CSV)을 씁니다.
8. **직원 본인 입력** — 직원 상세의 **등록 링크 복사**로 링크를 보내면, 직원이 로그인 없이 자기 개인정보·주민번호·서류를 직접 올립니다. 구글 계정 이메일로 등록된 직원은 그 계정으로 로그인해도 같은 화면을 씁니다.

## 직원 상세에서 저장하는 정보

| 구역 | 항목 | 볼 수 있는 사람 |
|---|---|---|
| 기본 | 이름, 전번, 이메일, 소속 지점(복수), 권한, 상태, 직책, 입사일, 메모 | 최고관리자 / 해당 지점 관리자 / 본인 |
| 주민등록번호 | 앞 6자리 | 최고관리자 / 해당 지점 관리자 / 본인 |
| | 뒤 7자리 | **최고관리자만** (본인은 입력만 가능) |
| 개인 정보 | 주소, 계좌번호, 보호자 성명·관계·연락처, 교육시작일, 근로시작일, 4대보험 등록일, 퇴사일 | 최고관리자 / 해당 지점 관리자 / 본인 |
| 급여 정보 | 기본급, 식대, 추가급여 1~3(항목명을 직접 입력), 인센티브(기준·금액), 기타 급여, 퇴직금 중간정산, 메모 | **최고관리자만** |
| 공개서류 | 이력서, 포트폴리오, 범죄기록조회서, 졸업증명서 | 최고관리자 / 해당 지점 관리자 (업로드는 본인도) |
| 비공개서류 | 주민등록등본, 통장사본, 사업자등록확인서, 고용보험 관련서류 | **최고관리자만** 열람 (업로드는 본인도) |
| 인사 평가 파일 / 기타 | 여러 파일, 항목명+설명+파일 | **최고관리자만** |

권한(`level`)별 요약: `super` 최고관리자 = 전체, `admin` 관리자 = 소속 지점 직원(급여·주민번호 뒷자리·비공개서류 제외), `staff` 직원 = 본인.
직원의 상태를 **퇴직**으로 바꾸면 연결된 `roles` 문서가 삭제되어 로그인 권한이 사라집니다.
증명서(재직/경력)는 직원 상세에서 발급하며, 인쇄 창이 열립니다.

## 일괄 등록

*직원 → 일괄 등록*에서 엑셀·구글시트의 표를 복사해 붙여넣거나 CSV 를 올립니다. `양식 내려받기`의 제목 줄을 쓰면 열 순서가 달라도 자동으로 맞춥니다.
열: 이름, 이메일, 소속 지점, 직책, 전번, 입사일, 권한, 상태, 주소, 계좌번호, 보호자 성명, 보호자와의 관계, 보호자 연락처, 교육시작일, 근로시작일, 4대보험 등록일, 퇴사일, 그리고 최고관리자 전용 급여 열(기본급, 식대, 추가급여1~3의 항목·금액, 인센티브 기준·금액, 기타 급여, 급여 메모). 금액은 `1,000,000`처럼 쉼표나 ‘원’이 있어도 읽습니다.
소속 지점은 이름 또는 ID 로 적고 여러 곳이면 `평촌원/반포원` 처럼 `/` 로 구분합니다. 오류가 있는 줄은 건너뛰고 정상인 줄만 등록합니다. 주민등록번호·서류·퇴직금 중간정산은 일괄 등록하지 않습니다.

## 데이터 구조

```
roles/{uid}                  { level, orgId, employeeId }  (등록 링크로 만든 권한은 { level:'staff', employeeId, selfToken })
employees/{employeeId}       { name, phone, email(소문자), orgIds[], orgId(=orgIds[0]), level, position,
                               joinedAt, status(active|leave|resigned), memo, selfToken, createdAt, updatedAt }
  private/personalInfo       { address, bankAccount, guardianName, guardianRelation, guardianPhone,
                               eduStartDate, workStartDate, insuranceRegDate, resignDate }
  private/residentFront      { value }          private/residentBack  { value }
  private/compensation       { baseSalary, mealAllowance, additionalLabel1~3, additionalSalary1~3, incentiveThreshold,
                               incentiveAmount, otherSalary, memo, severanceSettlements[] }
  private/flags              { residentFront, residentBack, uploaded: { 서류키: true } }
orgs/{orgId}                 { name, type(hq|branch), order, active }
meta/counters                { employee }   ← 사번(emp_0001 …) 자동 부여 카운터

Storage  hr/{사번}/pub/{키}__{시각}__{원본이름}   공개서류
         hr/{사번}/sec/{키}__{시각}__{원본이름}   비공개서류·인사평가(eval)·기타(etc)
```

## 보안 참고

- 주민등록번호와 급여는 Firestore 에 그대로 저장됩니다(암호화 저장 아님). 접근은 보안 규칙으로만 제한되므로, 규칙 게시와 최고관리자 계정 보호가 중요합니다.
- 등록 링크를 아는 사람은 해당 직원의 개인정보 입력란에 접근할 수 있습니다. 링크는 직원 본인에게만 전달하세요. 링크를 막으려면 Firestore `roles` 에서 `selfToken` 이 있는 문서를 삭제하고 직원 문서의 `selfToken` 을 지우면 됩니다.
- 직원은 본인 직원 문서를 규칙상 읽을 수 있어 `memo`(관리자 메모)도 읽힙니다. 화면에는 표시하지 않지만 민감한 내용은 메모에 적지 마세요.

## 로컬에서 보기

```bash
python3 -m http.server 8080
# http://localhost:8080/
```

ES 모듈을 쓰기 때문에 `file://` 로 직접 열면 동작하지 않습니다. 반드시 HTTP 서버로 띄워야 하며, `localhost` 가 Firebase 승인된 도메인에 있어야 로그인이 됩니다.
