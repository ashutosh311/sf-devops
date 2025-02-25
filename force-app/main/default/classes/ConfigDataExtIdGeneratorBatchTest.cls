/**
 * @author Stuart Grieve (Slalom)
 * @date 21/02/2025
 * @description Test class for ConfigDataExtIdGeneratorBatch.cls. Three methods to test the batch class.
 *              1. testBatchExecution - executes the batch to generate Ext Ids.
 *              2. testBatchWithExistingExternalIds - executes the batch with some existing External Ids to test idempotency.
 *              3. testEmptyBatch - tests the batch with an empty query locator.
 */
@isTest
private class ConfigDataExtIdGeneratorBatchTest {

    @testSetup
    static void setup() {
        // Create 10 test Product2 records
        List<Product2> products = new List<Product2>();
        for (Integer i = 0; i < 10; i++) {
            products.add(new Product2(Name = 'Test Product ' + i));
        }
        insert products;
    }

    @isTest
    static void testBatchExecution() {
        // Retrieve the products without External IDs
        List<Product2> products = [SELECT Id, Name, ExternalId FROM Product2 WHERE ExternalId = null ORDER BY Name];

        // Create an instance of the batch class
        ConfigDataExtIdGeneratorBatch batch = new ConfigDataExtIdGeneratorBatch('Product2', 'ExternalId');

        // Execute the batch
        Test.startTest();
        Database.executeBatch(batch);
        Test.stopTest();

        // Query the updated products
        List<Product2> updatedProducts = [SELECT Id, Name, ExternalId FROM Product2 WHERE ExternalId != null ORDER BY Name];

        // Assert that all products have been updated
        Assert.areEqual(products.size(), updatedProducts.size(), 'Not all products were updated.');

        // Assert that the External IDs are in the correct format
        String envSuffix = '';
        String sbName = System.DomainParser.parse(URL.getOrgDomainUrl()).getSandboxName();
        if (sbName!= null) {
            envSuffix = '-' + sbName;
        } else {
            envSuffix = '-Production';
        }

        for (Product2 prod: updatedProducts) {
            System.assert(prod.ExternalId.startsWith(prod.Id + envSuffix), 'External ID format is incorrect.');
        }
    }

    @isTest
    static void testBatchWithExistingExternalIds() {
        // Retrieve products and update a few with external Ids
        List<Product2> products = [SELECT Id, ExternalId FROM Product2 ORDER BY Name];
        products[0].ExternalId = 'TestExtId';
        update products[0];
        products[1].ExternalId = 'TestExtId2';
        update products[1];

        // Create an instance of the batch class
        ConfigDataExtIdGeneratorBatch batch = new ConfigDataExtIdGeneratorBatch('Product2', 'ExternalId');

        // Execute the batch
        Test.startTest();
        Database.executeBatch(batch);
        Test.stopTest();

        // Query the updated products
        List<Product2> updatedProducts = [SELECT Id, ExternalId FROM Product2 ORDER BY Name];

        // Assert that the pre-existing External IDs were not overwritten
        Assert.areEqual('TestExtId', updatedProducts[0].ExternalId, 'Existing External ID was overwritten.');
        Assert.areEqual('TestExtId2', updatedProducts[1].ExternalId, 'Existing External ID was overwritten.');

        // Assert that the other products have been updated
        for (Integer i = 2; i < updatedProducts.size(); i++) {
            System.assertNotEquals(null, updatedProducts[i].ExternalId, 'Not all products were updated.');
        }
    }

    @isTest
    static void testEmptyBatch() {
        // Delete all products to ensure an empty query locator
        delete [SELECT Id FROM Product2];

        ConfigDataExtIdGeneratorBatch batch = new ConfigDataExtIdGeneratorBatch('Product2', 'ExternalId');
        Test.startTest();
        Database.executeBatch(batch);
        Test.stopTest();

        // Query Products after the batch has run
        List<Product2> products = [SELECT Id, ExternalId FROM Product2];
        Assert.areEqual(0, products.size(), 'Products should be empty');
    }
}