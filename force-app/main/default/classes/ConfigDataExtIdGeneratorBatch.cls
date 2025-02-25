/**
 * @author Stuart Grieve (Slalom)
 * @date 21/02/2025
 * @description Batch class to generate External Ids for a given sObject. Used to support developers creating configuration data, where
 *              External Ids are required for executing Upserts to upstream environments.
 */
public class ConfigDataExtIdGeneratorBatch implements Database.Batchable<sObject>{
    
	public final String ObjectName;				// sObject Name
    public final String ExternalIdFieldName;	// API Name of the External Id field to populate
    public final String EnvSuffix;				// Suffix to append to the Record ID to identify which Org the ID was generated
    
    public ConfigDataExtIdGeneratorBatch(String o, String e){
        ObjectName = o; 
        ExternalIdFieldName = e;
        
        // Use URL.getOrgDomainUrl() to get Sandbox Name, or if not run in a Sandbox, set as 'Production'
        String sbName = System.DomainParser.parse(URL.getOrgDomainUrl()).getSandboxName();
        if (sbName != null) {
            EnvSuffix = '-' + sbName;
        } else {
            EnvSuffix = '-Production';
        }
        
    }
    
    public Database.QueryLocator start(Database.BatchableContext bc){
        
        // Query records in provided Object without an External Id already set
        return Database.getQueryLocator(
        	'SELECT Id, ' + ExternalIdFieldName + ' FROM ' + ObjectName + ' WHERE ' + ExternalIdFieldName + ' = null'
        );
    }
    
    public void execute(Database.BatchableContext bc, List<sObject> scope){
        List<sObject> toUpdate = new List<sObject>();
        
        for(sObject s : scope){
            try {
                if (s.get(ExternalIdFieldName) == null) { 			// Idempotency check to avoid overwriting batches already processed
                    String recordIdentifier = s.Id + EnvSuffix;
                    s.put(ExternalIdFieldName, recordIdentifier);
                    toUpdate.add(s);
                }
            } catch (Exception ex) {
                // Batch to be run in developer orgs, so no need for robust error handling
                System.debug('Error processing record ' + s.Id + ': ' + ex.getMessage());
            }
        }
        
        try {
            if (!toUpdate.isEmpty()) {
                update toUpdate;
            }    
        } catch (Exception ex) {
            // Batch to be run in developer orgs, so no need for robust error handling
            System.debug('Error updating records: ' + ex.getMessage());      
        }
    }
    
    public void finish(Database.BatchableContext bc){
    }
}