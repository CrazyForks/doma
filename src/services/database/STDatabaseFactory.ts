import { STDatabaseConfiguration } from './STDatabaseConfiguration';
import { STUserDatabase } from './user/STUserDatabase';
import { STDownloadDatabase } from './download/STDownloadDatabase';
import { STRuleTagDatabase } from './ruletag/STRuleTagDatabase';
import { STUserscriptDatabase } from './userscript/STUserscriptDatabase';
import { STCodeDatabase } from './code/STCodeDatabase';
import { STStorageDatabase } from './storage/STStorageDatabase';
import { STRuleDnrDatabase } from './rulednr/STRuleDnrDatabase';

export class STDatabaseFactory{
      
  public static userDatabase(): STUserDatabase {
    return new STUserDatabase(STDatabaseConfiguration.userConfiguration());
  }

  public static downloadDatabase(): STDownloadDatabase {
    return new STDownloadDatabase(STDatabaseConfiguration.downloadConfiguration());
  }

  public static ruleTagDatabase(): STRuleTagDatabase {
    return new STRuleTagDatabase(STDatabaseConfiguration.ruleTagConfiguration());
  }

  public static userscriptDatabase(): STUserscriptDatabase {
    return new STUserscriptDatabase(STDatabaseConfiguration.userscriptConfiguration());
  }

  public static codeDatabase(): STCodeDatabase {
    return new STCodeDatabase(STDatabaseConfiguration.codeConfiguration());
  }

  public static storageDatabase(): STStorageDatabase {
    return new STStorageDatabase(STDatabaseConfiguration.storageConfiguration());
  }

  public static ruleDnrDatabase(): STRuleDnrDatabase {
    return new STRuleDnrDatabase(STDatabaseConfiguration.ruleDnrConfiguration());
  }
}