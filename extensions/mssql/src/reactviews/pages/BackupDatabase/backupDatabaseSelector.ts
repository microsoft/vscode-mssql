import {
    BackupDatabaseReducers,
    BackupDatabaseState,
} from "../../../sharedInterfaces/backupDatabase";
import { useVscodeSelector } from "../../common/useVscodeSelector";

export function useBackupDatabaseSelector<T>(
    selector: (state: BackupDatabaseState) => T,
    equals?: (a: T, b: T) => boolean,
) {
    return useVscodeSelector<BackupDatabaseState, BackupDatabaseReducers, T>(selector, equals);
}
