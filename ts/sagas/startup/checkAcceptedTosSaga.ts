import * as pot from "italia-ts-commons/lib/pot";
import { Effect } from "redux-saga";
import { put, select, take } from "redux-saga/effects";

import { tosVersion } from "../../config";
import { navigateToTosScreen } from "../../store/actions/navigation";
import { profileSelector } from "../../store/reducers/profile";
import { GlobalState } from "../../store/reducers/types";
import { profileUpsert } from '../../store/actions/profile';

export function* checkAcceptedTosSaga(): IterableIterator<Effect> {
  const profileState: ReturnType<typeof profileSelector> = yield select<
    GlobalState
  >(profileSelector);

  if (pot.isNone(profileState)) {
    return;
  }

  if (
    "accepted_tos_version" in profileState.value &&
    profileState.value.accepted_tos_version &&
    profileState.value.accepted_tos_version === tosVersion
  ) {
    return;
  }

  // Navigate to the TosScreen
  yield put(navigateToTosScreen);

  // Here we wait the user accept the ToS
  yield take(profileUpsert.request);

}
