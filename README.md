# 자라다 People — JP 통합 HR 시스템

Firebase(Authentication + Firestore) 위에서 동작하는 정적 웹앱입니다. 빌드 과정 없이 GitHub Pages로 배포됩니다.

- 앱 주소: https://cooldesign81.github.io/jarada-people/
- 초기 설정 페이지: https://cooldesign81.github.io/jarada-people/setup.html

## 파일 구성

| 파일 | 역할 |
|---|---|
| `index.html` | 메인 앱 (로그인 → 대시보드 / 직원 / 조직 / 내 정보) |
| `setup.html` | 최초 관리자 등록용. 구글 로그인 후 UID 확인 → `roles` 문서 수동 생성 안내 |
| `js/firebase.js` | Firebase 설정·초기화 (모든 페이지 공유) |
| `js/app.js` | 메인 앱 로직 |
| `css/app.css` | 스타일 |
| `firestore.rules` | Firestore 보안 규칙 (콘솔에 붙여넣어 게시) |

## 처음 설정하는 순서

1. **보안 규칙 게시** — Firebase 콘솔 → Firestore Database → *규칙* 탭에 `firestore.rules` 내용을 붙여넣고 **게시**.
2. **승인된 도메인** — Authentication → 설정 → 승인된 도메인에 `cooldesign81.github.io` 추가 (로컬 테스트 시 `localhost` 포함).
3. **최초 관리자 등록** — `setup.html`에서 구글 로그인 → UID 복사 → Firestore `roles` 컬렉션에 문서 ID = UID 로 생성:
   - `level` = `super`
   - `orgId` = `hq`
   - `employeeId` = `emp_0001`
4. **앱 진입** — `index.html` 로 이동하면 본사(`orgs/hq`)가 자동 생성됩니다. *내 정보* 탭에서 본인 직원 정보를 등록합니다.
5. **조직·직원 등록** — *조직* 탭에서 지점을 추가하고, *직원* 탭에서 직원을 구글 계정 이메일과 함께 등록합니다.
6. **직원 로그인** — 등록된 직원이 그 이메일의 구글 계정으로 로그인하면 `roles/{uid}` 가 자동 생성되어 바로 이용할 수 있습니다. 따로 UID 를 받을 필요가 없습니다.

## 권한 등급

| level | 이름 | 범위 |
|---|---|---|
| `super` | 최고관리자 | 전체 조직 조회·등록·수정·삭제, 조직 관리 |
| `admin` | 관리자 | 소속 조직 직원 조회·등록·수정 (최고관리자 등급 부여 불가) |
| `staff` | 직원 | 본인 정보·조직 목록 조회 |

직원의 상태를 **퇴직**으로 바꾸면 연결된 `roles` 문서가 삭제되어 로그인 권한이 사라집니다. 다시 재직으로 바꾸면 다음 로그인 때 권한이 자동으로 재연결됩니다.

## 데이터 구조

```
roles/{uid}              { level, orgId, employeeId }
employees/{employeeId}   { name, email(소문자), orgId, level, position, phone,
                           joinedAt(YYYY-MM-DD), status(active|leave|resigned), memo,
                           createdAt, updatedAt }
orgs/{orgId}             { name, type(hq|branch), order, active, createdAt, updatedAt }
meta/counters            { employee }   ← 사번(emp_0001 …) 자동 부여 카운터
```

## 로컬에서 보기

```bash
python3 -m http.server 8080
# http://localhost:8080/
```

ES 모듈을 쓰기 때문에 `file://` 로 직접 열면 동작하지 않습니다. 반드시 HTTP 서버로 띄워야 하며, `localhost` 가 Firebase 승인된 도메인에 있어야 로그인이 됩니다.
