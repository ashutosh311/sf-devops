// Get Ids from Vlocity CLI json output 
List<Object> dataSetObjects = (List<Object>)JSON.deserializeUntyped('CURRENT_DATA_PACKS_CONTEXT_DATA');

// Ids Lists to update
List<Id> documentTemplateIDs = new List<Id>();
List<Id> contentVersionIDs = new List<Id>();

// Get Deployed Document Templates
for (Object obj : dataSetObjects) {
    Map<string,Object> objMap = (Map<string,Object>) obj;
    
    // Add Document Template Ids to list
    if ( objMap.containsKey('Id') && ((Id)objMap.get('Id')).getSObjectType() == DocumentTemplate.SObjectType ) {
        documentTemplateIDs.add((Id)objMap.get('Id'));
    }

    // Add Content Version Ids to list
    if ( objMap.containsKey('Id') && ((Id)objMap.get('Id')).getSObjectType() == ContentVersion.SObjectType ) {
        contentVersionIDs.add((Id)objMap.get('Id'));
    }
}
// Update Deployed Document as Active
if (documentTemplateIDs.size() > 0) {
    List<DocumentTemplate> documentTemplateToUpdate = new List<DocumentTemplate>();
    for(Id dtID : documentTemplateIDs) {
        DocumentTemplate dtToUpdate = new DocumentTemplate(Id = dtID, IsActive = true);
        documentTemplateToUpdate.add(dtToUpdate);
    }
    update documentTemplateToUpdate;
}

// Update Content Version with Parent Id for Files Library 'Docgen Document Template Library'
if (contentVersionIDs.size() > 0) {

    // Get Library
    Id workspaceId = [SELECT Id FROM ContentWorkspace WHERE Name = 'Docgen Document Template Library' LIMIT 1].Id;
    // Get ContentDocuments related to ContentVersions
    List<ContentVersion> contentVersionsWithDocIds = [SELECT Id, Title, ContentDocumentId, ContentDocument.ParentId FROM ContentVersion WHERE Id IN :contentVersionIDs];

    System.debug('Found ContentVersions: ' + contentVersionsWithDocIds);

    // Create ContentWorkspaceDoc record to associate Documents with Library
    if (workSpaceId != null && contentVersionsWithDocIds.size() > 0) {

        List<ContentWorkspaceDoc> contentWorkspaceDocsToInsert = new List<ContentWorkspaceDoc>();
        for (ContentVersion cv : contentVersionsWithDocIds) {
            if (cv.ContentDocumentId != null && cv.ContentDocument.ParentId == null) {
                System.debug('Updating ContentVersion: ' + cv.Id + ' ' + cv.Title);
                ContentWorkspaceDoc cwd = new ContentWorkspaceDoc(ContentDocumentId = cv.ContentDocumentId, ContentWorkspaceId = workspaceId);
                contentWorkspaceDocsToInsert.add(cwd);
            }
        }

        if (contentWorkspaceDocsToInsert.size() > 0) {
            insert contentWorkspaceDocsToInsert;
        }
    }
}
