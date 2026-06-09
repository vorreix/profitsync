There are multiple thing you've to do. I want you to to implement somethings very very properly and a very mobile friendly UX friendly, simple ux which people should love it. 
which are
1. Upon deleting a transaction or deleting multiple transactions, the value based on the transaction should not be subtracted or added to the wealth account,
 if there are any multiple split transactions related to that transaction, the user should be able to delete all the split transactions at once, upon deleting, it should not affect the main transaction and the wealth accounts money also synced accordingly.
  This is very very important.

2. In the  

3. In the PWA and also on the desktop and also on normal mobile browser, whenever there is a deployment has done previously, then next time when i open the app, or open the site, then the whole screen becomes white in color, and i've to reload the whole site inorder to make it work properly. This means the cache is not cleared properly. So the page should be loaded properly without any white screen.
4. In the 'Add quotation' modal, you've to add the currency symbol properly. and also there should be a date field too, (which is auto selected to today's date.)

5. http://localhost:3000/wealth/be8d50ab-fde8-44aa-9fd3-aa8d4e699115. in this page, you've to make sure the Account Detail card can be expandable and collapsable.
6. also in the same page, you've to manage the attachments section properly.
7. and also in the same. page, the i can't edit a transaction, the modal doesn't have a button to edit that transaction.

8. in the http://localhost:3000/dashboard  section you can see a card for Revenue vs Expensed by clients. there in the card you've to add View All button that navigate to analytics part. and also i want you to make a cap for top 10 clients data only. otherwise it is looking cluttered. also if the user selected some particular clients, then the data should be according to their data.

9. and another very important thing, understand all modals, and a modal is open and the user try to click on the esc button, then the modal should be closed. and also when the user try to click outside of the modal, then the modal should be closed, but in this case, persist the data in the modal, if the user tries to click outside or esc button. and if the modal is open and user tries to click on the save or submit or any update button, then the modal should be closed, and the data should be saved properly. and if the modal is open and user tries to click on the cancel or close button, then the modal should be closed, and the data should not be saved, or persisted.
 and another thing,if the modal is open and user tries to go back using swipe, then just the modal should close without persisting the data.

10.  and in any modals or forms, if there are any fields which are not properly filled or validation errors, you've to add a red border on that field inorder to indicate the user that this field is not properly filled or validation errors.

11. Making the use ui looks faster just by keeping everything like an illution that the data is saved suddenly,(like in the modals, etc) but if the data didn't properly working, just come back to the same modal with a toaster.  and inorder to making the UI data load more faster you've to find a tweak like making the data loading like chunk by chunks or smaller api calls, and making the api calls much faster and load it in the ui much faster and the rest of the data are synced in backedground properly,. THIS SHOULD BE DONE IN ALL PAGES IN ORDER TO MAKE OUR PRODUCT LOOKING FASTER FOR THE USER EXPERIENCE.
this is very imprtant, and inorder to make sure the the fastness, we've to perfectly make use of the caching of data, and also don't load the whole page or UI always, instead just load the particular value section or card, and also update the value appropriately. in this way the users will get a feeling that the UI is faster and smoother.

12. in the more button we don't need to keep the privacy policy terms and condition, refund policy etc. those should be in  different place.
13. make use of trash propery and restore properly (which should automatically update the transaction and also wealth data / values to be automatically updated correctly.
14. http://localhost:3000/organizations. in this page, the cards and the labels should be more good positiond and making it in a better way.
15. in the refer and earn program page, http://localhost:3000/referrals 
   you've to  show the referal code for each person and also there should be a button to copy the code and also share button to share the referal link. and it should work properly and making sure in anyhow if a new customer is signing up with referal link it should link to referal link properly.  and you've to make sure the user or user owned organizations purchase the pro, the defined amount is calculated and also it should be linked to the appropriate user accounts and referral programs, (this is little bit deep, but you've to make sure this is perfectly running super good, this is very important), and also, if a person is already linked with a referal code, you've to show that in the referal place, and then there should not able able to see the "have a referral code? enter code " section, instead you've to show the used code and invited person name.
16. Another important thing is that, in the http://localhost:3000/admin/plans plans section, even if the plan is 'personal' i can see the " Limits & features" section which is for clients and quotations, etc. It's not proper. you've to make sure it's properly working fine.




understand these tasks very properly and make sure you do a very deep research about
this with our code base and our UI and you can use /transition-creator for the best transtions for mobile ui and also for the desktop UI too. all. and ,and also use web searches for making sure everything is fine. and then make it structured and ordered and then make a very detailed plan to implement. and i want you to make sure you do like below, use all necessary skills, tools and workflow, playwright, websearch,deep research,ultrathink and anything, and also user /clear or /compact or anything whatever you want inorder to make sure the things are properly done
and you've to create git branches for each of them, but make sure you make branches from each like a chain from prevous to prevous. (currently i'm in dev, but make sure you create branch from dev first and then like a chain, and update one by one in the document for me to refer and you've to push each branch to github also.)

OUR MAIN FOCUS is the UI SIMPLICITY AND UX AND IT'S USABILTIY, AND IT'S LOVING UI DESING AND TRANSTION. AND IT'S MORE MOBILE UI-UX FOCUSED AND EVERY PLACING OF COMPONENTS AND ICONS AND DATA LOADIN AND EVERYHGINN SHOULD BE VERY WELL MANAGED, IT'S VERY VERY IMPORTANT.
finish each task properly and make sure you use worfklows and deep ultrathink and many more steps for implementing this task and finish it properly. and don't expect me to intervine at any point, i won't be available you've to do everthing by yourself itself, even the creation of the skill to work like this. after finishing all the task you've to create a skill that is 'work-finetuning' and save it, and push it to github,and test it to make sure it's working properly, and make sure there is a proper documentation about this process, how this works, and how to use it in the future, (like a generic one, like my instructions and deep researches and UI implementations, transition implementaions etc, without my intervention. )



UPDATES

http://localhost:3000/wealth/f41a1342-218e-4f3c-999f-d178b562368d

if the account detail page is already closed by me, you've to persist it. you've keep closed in the nexttime, until i open it agian. and if i open it again even
after restarting yoiu've to keep it open 

you didn't fix one of the biggest problem i mentioned. if I'm adding/deleting a transaction/ or adding/deleting a quotation or client , you're entirely loading the    
screen again instead of just adding/remving that pariticular data from the screen, and you've to use patch operation for this. and also making the UI looking smooth.  
this is very very very important for the user experience. you should update all the places that these things happening and make sure our UI is working just smooth.    
IMPORTANT. 




Http://localhost:3000/clients  in create new client modal, keep the onboarding date as default today's date. also keep onboarding date and category as sidewise
inorder to optimize the UI. 


http://localhost:3000/transactions. - on the edit screen i should be able to add/remove attachment/update it's name/view the attachment / preview the attachment.

and another thing, http://localhost:3000/wealth on the wealth cards, if the logo is loaded from the API, if the real logo of each bank is exist, then you've to show
the logo little zoomed it in the round and keeping it fill in the round, because the logo is looking small. also make sure you're doing the same thing in the Add
Transaction Modal too. 



now, update the skill you created accordingly , and also update it with the UI, and data loading mechanism after adding/deleting/updating any data, and also the UI speed. 




For the drag and drop it's not even working on the mobile too. you've to make sure it's working on the mobile screen. and you can keep a drag and drop button near to the 3 dots of the card and buy using it they can drag and sort the account positions, and also they can do the drag and drop on to another account for making the money transfer





i should be able to add bank name, which should auto populate the name and logo.
and there should be the address, like location,  and  there will be location identifier for each contry like for india ifsc, etc. also othe countries have their own. but some banks might be online banks.

and based on the location and country, it should change the account number label. like IBAN, account number (i don't know about it you've to search on web about it and implement)


http://localhost:3002/transactions

when i transact into multiple way, i can see it's as two differnt transaction, it should be single transaction, but you've to show it's splitted into two




Personal + Company + Family.

implement TWA

show closed clients accounts



I want you to to implement somethings very very properly and a very mobile friendly UX friendly, simple ux which people should love it. 
which are, first one is an important bug fix (it's not actually a bug, but a refactor)
When i try to transact a money using split accounts for example 100 euros i transact using 3 accounts, 1.cash -30 euro, 2. AC1-25 euros and 3. AC2-45 euros.
then in the transactions, it's considered as 3 different transactions. it should not be like that, it will be only 1 transaction with other sub transactions, you've to show this properly in the UI. and in the detail page of this specific transaction it should properly shows the transaction details. this is very very important. 

once you finish this next task is 

Upon creating a Bank Account, I should be able to add bank name, and when i type this name the fiels should autopoplutae the name and the logo. and which logo should be stored on backend for future purposes.
and I should be able to add/change address, like location, country, and based on country change, it should change the account name label like for india it account number but for italy iban, and then swift there are many(search on internet and find it and based on country selection it should automatically change). and there should be a location textfield, and also there should be a note section too. also attachments too. i should be able to close accounts too (in the detail page of the account)
If you need brandfetch api key which is there in the .env.local. but if you find out some other easier and better way to fetch these informaiton and logo, use it, because this is in free version and have huge limitations. search on internet and find a the best way as possible

and when you are in a particular account like (http://localhost:3000/wealth/1609e57f-1720-4f64-996b-e7711755fd65) this page, you can see all transactions and you can add transactions. the + overlay button should work as a add transaction for this specific account. 
but there is a problem here, currenly when i click add transaction button, it navigate to the transactions page and opens the add transaction modal there. but it shouldn't be like that, it should work as a overlay, means it should pop up a modal from bottom overlaying on the current page. and once i save the transaction it should close the modal and i should be able to see the transaction in the same list of the current account page. this is important.. 


and the 'Adjust' amount icon button in each account should be in kept in just near to the Balance of each account. 


and there should be anothe feature which is to transfer money from one account to another account. and this will be a transaction itself (but never show this in in the transaction modal. you can show a transfer option in http://localhost:3000/wealth this page. and it can be possible from one account to another account (not multiple at a time)) and this can be possible if we drag the car of one account on top of another account and drop it then it will open a modal with from account and to account and amount and date and notes and attachments (but keep it like a wizard, one step at a time. add the money first, then the rest later, similar to n26 spaces), in mobile also this should work seamlessly.


