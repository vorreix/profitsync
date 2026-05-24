

The next task you've to do is,

create a git feature branch using `git checkout -b feature/organization-feature_maqbool` and work in this branch, after the work is done, commit the changes and push to the remote repository using `git push origin feature/organization-feature_maqbool`.

The user should have atleast one organiaation, by default they can have the personal one.
should be able to create multiple orgnaization and they could be able to search and switch between organization and athe dashboard and all other data will change according to the organization which is selected.

while creating an account and also while creating a user itself, there should be privacy policy and all other legal documents that the user should have to agree to use the app. and there should be a way to view those documents for the user. 



Test using playwrite and make sure everything is properly working and you can do any other changes which you think is necessary to make the app better. and test, fix and repeat until it's proper

git push the changes



IMPORTANT: then clear the session (as a new session with empty context)


create a git feature branch using `git checkout -b feature/sueradmin_maqbool` from `feature/organization-feature_maqbool` and work in this branch, after the work is done, commit the changes and push to the remote repository using `git push origin feature/sueradmin_maqbool`.


Then create a super admin section which will be a completely different UI and where  we can see all details about the app and should be able to perform actions on users and organizations, and also about the subscription details and invoices and all other details. should be able to search and filter through users and organizations and subscriptions and invoices. we can do all manipulations(mean everything without any restriction) 

Test using playwrite and make sure everything is properly working and you can do any other changes which you think is necessary to make the app better. and test, fix and repeat until it's proper

git push changes


IMPORTANT: then clear the session (as a new session with empty context)


create a git feature branch using `git checkout -b feature/user-management_maqbool` from `feature/sueradmin_maqbool` and work in this branch, after the work is done, commit the changes and push to the remote repository using `git push origin feature/user-management_maqbool`.

Then we've to implement the user management section and there should be user invitations for each organizations, with different role like owner, admin, editor, viewer.
one user can be a part of multiple organization with organization specific roles. 

And then we've to implment the subscription feature to our software which is, there should be a subscription page where user can see different subscription plans and should be able to subscribe to a plan, after the subscription is successful, the user should be able to use the premium features of the app. this subscription is belongs to an organization. (not for the user.)
we've only two plans, which is Free, and Premium

and upon successfull subscription, the user should be able to create more clients (10 clients are free), add more transactions (30 transaction per client limit for free plan), create more quotations (30 quotations are free, (we've to think about the conversion of clients from quotation also should be properly check with respect to the plan)), upload more files (1 mb file limit for free plan, 10 mb file limit for pro plan, 1 attachment per transaction for free plan, and 10 attachments per transaction for pro plan.), add more notes (200 charector limit for free, unlimited charectory for pro user.), etc. according to the subscription plan.
So, the subscription payments should be reccuring, and also subscription cancellation and invoice also should be managed properly. 


Pricing should be montly or yearly recurring, and user can choose between monthly/yearly.

and i should be able to choose the discount for monthly and yearly, (should be different for both, and should be flexible to update it from the super admin section)

and the price can be in USD, but it will be different for geo location (not just IP, actual location.) for example india should be 4999 inr monthly (for now we can give 50% discount for the first month for the initial users ) and then if they use yearly then it will be 49999 inr yearly (with 50 percent discount for the first year for the initial users)
All these pricing and discounts and all other things i should be able to configure from the super admin section.


Currently we can use RazorPay for the subscription payment integration. and make sure it's properly working and updating everything properly. and send an email notification to the user about the subscription and about the features which are unlocked. also manage the cancellation and invoice.
(create a detailed razorpay_integration.md file for the reference for what do to step by step and how the whole process is.)

Test using playwrite and make sure everything is properly working and you can do any other changes which you think is necessary to make the app better. and test, fix and repeat until it's proper

the git push the changes


IMPORTANT: then clear the session using /clear command (as a new session with empty context)


create a git feature branch using `git checkout -b feature/mobile_ui_updates_maqbool` from `feature/user-management_maqbool` and work in this branch, after the work is done, commit the changes and push to the remote repository using `git push origin feature/mobile_ui_updates_maqbool`.


Then you update the mobile screen of this application to a another level, it should feel like a native mobile app, and should be very smooth and easy to use, and should be very beautiful and modern and premium looking (it should never feel like an AI made app). And make sure all the features are working properly on mobile screen also. 
you've to manage all the sections in a very proper way for the mobile screen, (never think that, it's just a the current mobile version of the app, but you've to make a very deep research about the app and the mobile screen designs and user experice , and make it a level higher from the current mobile screen of the app, which will make the user to feel like it's a professional native mobile app.)

Test using playwrite and make sure everything is properly working and you can do any other changes which you think is necessary to make the app better. and test, fix and repeat until it's proper
